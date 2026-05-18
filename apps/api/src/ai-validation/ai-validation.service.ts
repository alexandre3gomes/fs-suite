import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';

import { ActivityService } from '../activity/activity.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

import type { ValidateFlightPlanDto } from './dto/validate-flight-plan.dto';
import type { AiMeta, ValidationItem, ValidationResponse } from './dto/validation-response.dto';
import { FLIGHT_PLAN_VALIDATION_SYSTEM_PROMPT } from './prompts/system-prompt';
import type { AiProvider } from './providers/ai-provider.interface';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { GroqProvider } from './providers/groq.provider';
import { OpenAiProvider } from './providers/openai.provider';

const RATE_LIMIT_PER_DAY = 5;
const RATE_LIMIT_TTL = 86_400;

const DEFAULT_MODELS = {
  gemini: 'gemini-2.5-flash',
  groq: 'llama-3.3-70b-versatile',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-2.5-flash',
} as const;

function getDefaultModel(provider: string): string {
  return (DEFAULT_MODELS as Record<string, string>)[provider] ?? DEFAULT_MODELS.openai;
}

type FreqMap = Map<string, { type: string; description: string; frequencyMhz: number }[]>;

@Injectable()
export class AiValidationService {
  private readonly logger = new Logger(AiValidationService.name);
  private readonly geminiProvider = new GeminiProvider();
  private readonly groqProvider = new GroqProvider();
  private readonly openaiProvider = new OpenAiProvider();
  private readonly anthropicProvider = new AnthropicProvider();

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly config: ConfigService,
    private readonly activity: ActivityService,
  ) {}

  async validateFlightPlan(
    userId: string,
    dto: ValidateFlightPlanDto,
  ): Promise<ValidationResponse> {
    const freqMap = await this.lookupFrequencies(dto);
    const userPrompt = this.buildUserPrompt(dto, freqMap);
    const { raw, meta } = await this.callAiWithFallback(userId, userPrompt);
    const result = this.parseValidationResponse(raw);
    result.meta = meta;

    void this.activity.log('ai_validation.completed', userId, {
      origin: dto.originIcao,
      destination: dto.destinationIcao,
      status: result.overallStatus,
      provider: meta.provider,
      byok: meta.byok,
    });

    return result;
  }

  private async lookupFrequencies(dto: ValidateFlightPlanDto): Promise<FreqMap> {
    const icaos = [dto.originIcao, dto.destinationIcao, dto.alternateIcao].filter(
      (v): v is string => !!v,
    );
    if (icaos.length === 0) return new Map();

    const frequencies = await this.prisma.frequency.findMany({
      where: { airportIcao: { in: icaos } },
      orderBy: [{ airportIcao: 'asc' }, { type: 'asc' }],
    });

    const map: FreqMap = new Map();
    for (const f of frequencies) {
      const list = map.get(f.airportIcao) ?? [];
      list.push({ type: f.type, description: f.description, frequencyMhz: f.frequencyMhz });
      map.set(f.airportIcao, list);
    }
    return map;
  }

  private buildUserPrompt(dto: ValidateFlightPlanDto, freqMap: FreqMap): string {
    const plan: Record<string, unknown> = {};

    plan.flight = {
      rules: dto.flightRules ?? 'VFR',
      condition: dto.flightCondition === 'night' ? 'NOTURNO' : 'DIURNO',
    };

    plan.origin = this.buildAerodromeBlock(
      dto.originIcao, dto.originName, dto.originElevationFt,
      dto.originRunwayInUse, dto.originRunways, dto.originMetarRaw, dto.originTafRaw,
      freqMap.get(dto.originIcao ?? '') ?? [],
    );

    plan.destination = this.buildAerodromeBlock(
      dto.destinationIcao, dto.destinationName, dto.destinationElevationFt,
      dto.destinationRunwayInUse, dto.destinationRunways, dto.destinationMetarRaw, dto.destinationTafRaw,
      freqMap.get(dto.destinationIcao ?? '') ?? [],
    );
    if (dto.tripMinutes != null) {
      const eta = new Date(Date.now() + dto.tripMinutes * 60_000);
      (plan.destination as Record<string, unknown>).etaZulu = eta.toISOString().slice(0, 16) + 'Z';
      (plan.destination as Record<string, unknown>).etaMinutes = dto.tripMinutes;
    }

    if (dto.alternateIcao) {
      plan.alternate = {
        ...this.buildAerodromeBlock(
          dto.alternateIcao, dto.alternateName, dto.alternateElevationFt,
          dto.alternateRunwayInUse, dto.alternateRunways, dto.alternateMetarRaw, dto.alternateTafRaw,
          freqMap.get(dto.alternateIcao) ?? [],
        ),
        distanceFromDestNm: dto.altDistanceNm ?? null,
      };
    }

    plan.aircraft = {
      icaoType: dto.aircraftType ?? null,
      name: dto.aircraftName ?? null,
      cruiseSpeedKts: dto.cruiseSpeedKts ?? null,
      fuelBurnLph: dto.fuelBurnLph ?? null,
      emptyWeightKg: dto.emptyWeightKg ?? null,
      mtowKg: dto.mtowKg ?? null,
      fuelCapacityL: dto.fuelCapacityL ?? null,
      performanceCategory: dto.performanceCategory ?? null,
    };

    if (dto.stations?.length) {
      plan.weightAndBalance = {
        stations: dto.stations.map((s) => ({
          id: s.id,
          label: s.labelKey,
          maxKg: s.maxKg,
          arm: s.arm,
        })),
        note: 'Dados reais do POH — priorize estes valores sobre estimativas.',
      };
    }

    plan.route = {
      routeString: dto.routeText ?? null,
      cruiseLevel: dto.cruiseLevel ?? null,
      totalDistanceNm: dto.totalDistanceNm ?? null,
      tripMinutes: dto.tripMinutes ?? null,
      todMinutes: dto.todMinutes ?? null,
      todDistanceNm: dto.todDistanceNm ?? null,
    };

    if (dto.routeLegs?.length) {
      plan.routeLegs = dto.routeLegs.slice(0, 50).map((leg) => ({
        from: leg.from,
        to: leg.to,
        distanceNm: +leg.distanceNm.toFixed(1),
        trueCourse: Math.round(leg.trueCourse),
        magneticCourse: Math.round(leg.magneticCourse),
        magneticDeclination: +leg.magneticDeclination.toFixed(1),
        suggestedAltitudesFt: leg.suggestedAltitudes ?? [],
      }));
    }

    if (dto.visualReferences?.length) {
      plan.visualReferences = dto.visualReferences.slice(0, 30).map((ref) => ({
        seq: ref.sequence,
        name: ref.name,
        distanceNm: ref.distanceNm ?? null,
        timeMin: ref.timeMin ?? null,
      }));
    }

    if (dto.reaCorridors?.length) {
      plan.reaCorridors = dto.reaCorridors.map((c) => ({
        region: c.regionName,
        corridor: c.corridorName,
        type: c.tipo === 'Obrig' ? 'OBRIGATÓRIO' : 'RECOMENDADO',
        segments: c.segments?.map((s) => ({
          from: s.from, to: s.to,
          altMinFt: s.altMin, altMaxFt: s.altMax,
          altCompulsoryFt: s.altComp ?? null,
        })) ?? [],
      }));
    }

    plan.weight = {
      emptyWeightKg: dto.emptyWeightKg ?? null,
      payloadKg: dto.payloadKg ?? null,
      takeoffWeightKg: dto.takeoffWeightKg ?? null,
      mtowKg: dto.mtowKg ?? null,
    };

    plan.fuel = {
      onBoardKg: dto.fuelCurrentTotal ?? null,
      consumptionKgPerHour: dto.fuelConsumptionPerHour ?? null,
      tankCapacityL: dto.fuelCapacityL ?? null,
      perWingKg: dto.fuelPerWing ?? null,
      tripFuelKg: dto.tripFuelKg ?? null,
      altFuelKg: dto.altFuelKg ?? null,
      contingencyPct: dto.contingencyPct ?? null,
      contingencyFuelKg: dto.contingencyFuelKg ?? null,
      reserveFuelKg: dto.reserveFuelKg ?? null,
      reserveMinutes: dto.fuelReserveMinutes ?? null,
      minRequiredKg: dto.minFuelKg ?? null,
      totalRequiredKg: dto.fuelRequiredTotal ?? null,
      enduranceMinutes: dto.enduranceMinutes ?? null,
    };

    plan.operational = {
      callsign: dto.callsign ?? null,
      item18: dto.item18Text ?? dto.remarks ?? null,
    };

    const json = JSON.stringify(plan, null, 2);

    return `Analise o plano de voo VFR abaixo e produza o briefing completo conforme o template do sistema.

DADOS DO PLANO:
${json}

LEMBRETE: produza 20-35 items. Cada description deve ser um parágrafo completo com dados concretos: cálculos de vento (fórmula + valores), frequências reais (MHz), V-speeds, fraseologia completa (chamada do piloto + resposta ATC + readback), sequência cold-and-dark, circuito de tráfego detalhado. Nunca genérico.`;
  }

  private buildAerodromeBlock(
    icao?: string, name?: string, elevationFt?: number,
    runwayInUse?: string,
    runways?: { ident: string; headingDeg?: number | null; lengthFt?: number | null }[],
    metar?: string, taf?: string,
    frequencies?: { type: string; description: string; frequencyMhz: number }[],
  ): Record<string, unknown> {
    return {
      icao: icao ?? null,
      name: name ?? null,
      elevationFt: elevationFt ?? null,
      runwayInUse: runwayInUse ?? null,
      runways: runways?.map((r) => ({
        ident: r.ident,
        headingDeg: r.headingDeg ?? null,
        lengthFt: r.lengthFt ?? null,
      })) ?? [],
      frequencies: frequencies?.map((f) => ({
        type: f.type,
        description: f.description,
        mhz: f.frequencyMhz,
      })) ?? [],
      metar: metar ?? null,
      taf: taf ?? null,
    };
  }

  private async callAiWithFallback(
    userId: string,
    userPrompt: string,
  ): Promise<{ raw: string; meta: AiMeta }> {
    const byok = await this.getUserByokConfig(userId);

    if (byok) {
      const model = getDefaultModel(byok.provider);
      try {
        const provider = this.getProvider(byok.provider);
        const raw = await provider.generateCompletion(
          FLIGHT_PLAN_VALIDATION_SYSTEM_PROMPT,
          userPrompt,
          { apiKey: byok.apiKey, model },
        );
        return { raw, meta: { provider: byok.provider, model, byok: true } };
      } catch (err) {
        const message = (err as Error).message ?? '';
        const isQuotaOrAuth = /429|401|403|quota|billing|insufficient|invalid.*key/i.test(message);

        if (isQuotaOrAuth) {
          throw new HttpException(
            {
              statusCode: HttpStatus.PAYMENT_REQUIRED,
              message: `Your ${byok.provider.toUpperCase()} API key returned an error: ${message}. Check your billing/quota at the provider dashboard.`,
              provider: byok.provider,
            },
            HttpStatus.PAYMENT_REQUIRED,
          );
        }

        this.logger.warn(
          `BYOK provider ${byok.provider} failed for user ${userId}, falling through to free tier: ${message}`,
        );
      }
    }

    const rateLimit = await this.checkRateLimit(userId);
    if (!rateLimit.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Daily AI validation limit reached. Configure your own API key in Profile for unlimited use.',
          remaining: 0,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const geminiKey = this.config.get<string>('GEMINI_API_KEY');
    if (geminiKey) {
      try {
        const model = DEFAULT_MODELS.gemini as string;
        const raw = await this.geminiProvider.generateCompletion(
          FLIGHT_PLAN_VALIDATION_SYSTEM_PROMPT,
          userPrompt,
          { apiKey: geminiKey, model },
        );
        await this.incrementRateLimit(userId);
        const remaining = RATE_LIMIT_PER_DAY - (await this.getCurrentUsage(userId));
        return { raw, meta: { provider: 'gemini', model, byok: false, remaining } };
      } catch (err) {
        this.logger.warn(`Gemini free tier failed: ${(err as Error).message}`);
      }
    }

    const groqKey = this.config.get<string>('GROQ_API_KEY');
    if (groqKey) {
      try {
        const model = DEFAULT_MODELS.groq as string;
        const raw = await this.groqProvider.generateCompletion(
          FLIGHT_PLAN_VALIDATION_SYSTEM_PROMPT,
          userPrompt,
          { apiKey: groqKey, model },
        );
        await this.incrementRateLimit(userId);
        const remaining = RATE_LIMIT_PER_DAY - (await this.getCurrentUsage(userId));
        return { raw, meta: { provider: 'groq', model, byok: false, remaining } };
      } catch (err) {
        this.logger.warn(`Groq free tier failed: ${(err as Error).message}`);
      }
    }

    throw new BadGatewayException(
      'AI validation is temporarily unavailable. Please try again later.',
    );
  }

  private async getUserByokConfig(
    userId: string,
  ): Promise<{ provider: string; apiKey: string } | null> {
    try {
      const conn = await this.prisma.integrationConnection.findUnique({
        where: { userId_service: { userId, service: 'ai-validation' } },
      });
      if (!conn?.metadata) return null;

      const meta = conn.metadata as {
        provider?: string;
        encryptedApiKey?: string;
      };
      if (!meta.provider || !meta.encryptedApiKey) return null;

      const apiKey = this.encryption.decrypt(meta.encryptedApiKey);
      return { provider: meta.provider, apiKey };
    } catch (err) {
      this.logger.warn(`Failed to load BYOK config: ${(err as Error).message}`);
      return null;
    }
  }

  private getProvider(name: string): AiProvider {
    switch (name) {
      case 'openai':
        return this.openaiProvider;
      case 'anthropic':
        return this.anthropicProvider;
      case 'google':
        return this.geminiProvider;
      default:
        return this.openaiProvider;
    }
  }

  private async checkRateLimit(
    userId: string,
  ): Promise<{ allowed: boolean; remaining: number }> {
    const key = `ai-validation:rate:${userId}:${new Date().toISOString().slice(0, 10)}`;
    const client = this.redis.getClient();

    const count = parseInt((await client.get(key)) ?? '0', 10);
    const remaining = Math.max(0, RATE_LIMIT_PER_DAY - count);
    return { allowed: count < RATE_LIMIT_PER_DAY, remaining };
  }

  private async getCurrentUsage(userId: string): Promise<number> {
    const key = `ai-validation:rate:${userId}:${new Date().toISOString().slice(0, 10)}`;
    return parseInt((await this.redis.getClient().get(key)) ?? '0', 10);
  }

  private async incrementRateLimit(userId: string): Promise<void> {
    const key = `ai-validation:rate:${userId}:${new Date().toISOString().slice(0, 10)}`;
    const client = this.redis.getClient();

    const newCount = await client.incr(key);
    if (newCount === 1) {
      await client.expire(key, RATE_LIMIT_TTL);
    }
  }

  private parseValidationResponse(raw: string): ValidationResponse {
    try {
      let jsonStr = raw.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(jsonStr) as ValidationResponse;

      if (!parsed.overallStatus || !Array.isArray(parsed.items) || !parsed.summary) {
        throw new Error('Invalid response structure');
      }

      const validStatuses = new Set(['pass', 'warnings', 'issues']);
      if (!validStatuses.has(parsed.overallStatus)) {
        parsed.overallStatus = 'warnings';
      }

      const validItemStatuses = new Set(['pass', 'warn', 'fail']);
      parsed.items = parsed.items
        .filter(
          (item: ValidationItem) =>
            item.category && item.status && item.title && item.description,
        )
        .map((item: ValidationItem) => ({
          ...item,
          status: validItemStatuses.has(item.status) ? item.status : 'warn',
        }));

      return parsed;
    } catch (err) {
      this.logger.warn(`Failed to parse AI response: ${(err as Error).message}`);
      Sentry.captureMessage('AI validation response parse failure', {
        level: 'warning',
        extra: { rawLength: raw.length, rawPreview: raw.slice(0, 200) },
      });

      return {
        overallStatus: 'warnings',
        items: [
          {
            category: 'SAFETY',
            status: 'warn',
            title: 'Validação incompleta',
            description:
              'Não foi possível processar a resposta da IA. Tente novamente.',
          },
        ],
        summary:
          'A validação não pôde ser completada. Por favor, tente novamente.',
      };
    }
  }
}
