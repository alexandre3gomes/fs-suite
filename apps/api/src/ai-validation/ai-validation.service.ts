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
import type { ValidationItem, ValidationResponse } from './dto/validation-response.dto';
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
    const userPrompt = this.buildUserPrompt(dto);
    const raw = await this.callAiWithFallback(userId, userPrompt);
    const result = this.parseValidationResponse(raw);

    void this.activity.log('ai_validation.completed', userId, {
      origin: dto.originIcao,
      destination: dto.destinationIcao,
      status: result.overallStatus,
    });

    return result;
  }

  private formatRunways(
    runways: { ident: string; headingDeg?: number | null; lengthFt?: number | null }[] | undefined,
  ): string | null {
    if (!runways?.length) return null;
    return runways
      .map((r) => {
        const parts = [r.ident];
        if (r.headingDeg != null) parts.push(`hdg ${Math.round(r.headingDeg)}°`);
        if (r.lengthFt != null) parts.push(`${r.lengthFt} ft`);
        return parts.join(' ');
      })
      .join(' | ');
  }

  private buildUserPrompt(dto: ValidateFlightPlanDto): string {
    const lines: string[] = ['## Flight Plan to Validate', ''];

    if (dto.flightRules) lines.push(`**Flight Rules**: ${dto.flightRules}`);
    if (dto.flightCondition) lines.push(`**Flight Condition**: ${dto.flightCondition === 'night' ? 'NOTURNO' : 'DIURNO'}`);

    // Origin
    lines.push('', '### Origin');
    if (dto.originIcao) {
      lines.push(
        `**Aerodrome**: ${dto.originIcao}${dto.originName ? ` (${dto.originName})` : ''}${dto.originElevationFt != null ? ` — Elevation: ${dto.originElevationFt} ft` : ''}`,
      );
    }
    if (dto.originRunwayInUse) lines.push(`**Runway in use**: ${dto.originRunwayInUse}`);
    const originRwys = this.formatRunways(dto.originRunways);
    if (originRwys) lines.push(`**Available runways**: ${originRwys}`);
    if (dto.originMetarRaw) lines.push(`**METAR**: ${dto.originMetarRaw}`);
    if (dto.originTafRaw) lines.push(`**TAF**: ${dto.originTafRaw}`);

    // Destination
    lines.push('', '### Destination');
    if (dto.destinationIcao) {
      lines.push(
        `**Aerodrome**: ${dto.destinationIcao}${dto.destinationName ? ` (${dto.destinationName})` : ''}${dto.destinationElevationFt != null ? ` — Elevation: ${dto.destinationElevationFt} ft` : ''}`,
      );
    }
    if (dto.destinationRunwayInUse) lines.push(`**Runway in use**: ${dto.destinationRunwayInUse}`);
    const destRwys = this.formatRunways(dto.destinationRunways);
    if (destRwys) lines.push(`**Available runways**: ${destRwys}`);
    if (dto.destinationMetarRaw) lines.push(`**METAR**: ${dto.destinationMetarRaw}`);
    if (dto.destinationTafRaw) lines.push(`**TAF**: ${dto.destinationTafRaw}`);
    if (dto.tripMinutes != null) {
      const now = new Date();
      const eta = new Date(now.getTime() + dto.tripMinutes * 60_000);
      lines.push(`**ETA**: ${eta.toISOString().slice(0, 16)}Z (~${dto.tripMinutes} min)`);
    }

    // Alternate
    if (dto.alternateIcao) {
      lines.push('', '### Alternate');
      lines.push(
        `**Aerodrome**: ${dto.alternateIcao}${dto.alternateName ? ` (${dto.alternateName})` : ''}${dto.alternateElevationFt != null ? ` — Elevation: ${dto.alternateElevationFt} ft` : ''}`,
      );
      if (dto.alternateRunwayInUse) lines.push(`**Runway in use**: ${dto.alternateRunwayInUse}`);
      const altRwys = this.formatRunways(dto.alternateRunways);
      if (altRwys) lines.push(`**Available runways**: ${altRwys}`);
      if (dto.alternateMetarRaw) lines.push(`**METAR**: ${dto.alternateMetarRaw}`);
      if (dto.alternateTafRaw) lines.push(`**TAF**: ${dto.alternateTafRaw}`);
      if (dto.altDistanceNm != null) lines.push(`**Distance from destination**: ${dto.altDistanceNm} NM`);
    }

    // Aircraft
    lines.push('', '### Aircraft');
    if (dto.aircraftType)
      lines.push(`**Type**: ${dto.aircraftType}${dto.aircraftName ? ` (${dto.aircraftName})` : ''}`);
    if (dto.cruiseSpeedKts != null) lines.push(`**Cruise speed**: ${dto.cruiseSpeedKts} kt`);

    // Route
    lines.push('', '### Route');
    if (dto.routeText) lines.push(`**Route string**: ${dto.routeText}`);
    if (dto.cruiseLevel) lines.push(`**Cruise Level**: ${dto.cruiseLevel}`);
    if (dto.totalDistanceNm != null) lines.push(`**Total distance**: ${dto.totalDistanceNm} NM`);
    if (dto.tripMinutes != null) lines.push(`**Trip time**: ${dto.tripMinutes} min`);
    if (dto.todMinutes != null) lines.push(`**Top of descent**: ${dto.todMinutes} min before destination`);
    if (dto.todDistanceNm != null) lines.push(`**TOD distance**: ${dto.todDistanceNm} NM before destination`);

    if (dto.routeLegs?.length) {
      lines.push('', '**Route Legs** (in order):');
      for (const leg of dto.routeLegs.slice(0, 50)) {
        const altStr = leg.suggestedAltitudes?.length
          ? ` | Alt sugeridas: ${leg.suggestedAltitudes.join(', ')} ft`
          : '';
        lines.push(
          `- ${leg.from} → ${leg.to}: ${leg.distanceNm.toFixed(1)} NM, TC ${Math.round(leg.trueCourse)}°, MC ${Math.round(leg.magneticCourse)}° (MagVar ${leg.magneticDeclination > 0 ? '+' : ''}${leg.magneticDeclination.toFixed(1)}°)${altStr}`,
        );
      }
    }

    // Visual references
    if (dto.visualReferences?.length) {
      lines.push('', '**Visual References** (route reconnaissance):');
      for (const ref of dto.visualReferences.slice(0, 30)) {
        const parts = [`#${ref.sequence} ${ref.name}`];
        if (ref.distanceNm != null) parts.push(`${ref.distanceNm} NM from origin`);
        if (ref.timeMin != null) parts.push(`~${ref.timeMin} min`);
        lines.push(`- ${parts.join(' — ')}`);
      }
    }

    // REA Corridors
    if (dto.reaCorridors?.length) {
      lines.push('', '### REA Corridors (route crosses these regions)');
      for (const corridor of dto.reaCorridors) {
        lines.push(`**${corridor.regionName} — ${corridor.corridorName}** (${corridor.tipo === 'Obrig' ? 'OBRIGATÓRIO' : 'RECOMENDADO'})`);
        if (corridor.segments?.length) {
          for (const seg of corridor.segments) {
            const altComp = seg.altComp != null ? ` (alt compulsória: ${seg.altComp} ft)` : '';
            lines.push(`  - ${seg.from} → ${seg.to}: ${seg.altMin}–${seg.altMax} ft${altComp}`);
          }
        }
      }
    }

    // Weight
    lines.push('', '### Weight & Balance');
    if (dto.emptyWeightKg != null) lines.push(`**Empty weight**: ${dto.emptyWeightKg} kg`);
    if (dto.payloadKg != null) lines.push(`**Payload**: ${dto.payloadKg} kg`);
    if (dto.takeoffWeightKg != null) lines.push(`**Takeoff weight**: ${dto.takeoffWeightKg} kg`);
    if (dto.mtowKg != null) lines.push(`**MTOW**: ${dto.mtowKg} kg`);

    // Fuel
    lines.push('', '### Fuel');
    if (dto.fuelCurrentTotal != null) lines.push(`**Fuel on board**: ${dto.fuelCurrentTotal} kg`);
    if (dto.fuelConsumptionPerHour != null) lines.push(`**Consumption**: ${dto.fuelConsumptionPerHour} kg/h`);
    if (dto.fuelCapacityL != null) lines.push(`**Tank capacity**: ${dto.fuelCapacityL} L`);
    if (dto.fuelPerWing != null) lines.push(`**Per wing**: ${dto.fuelPerWing} kg`);
    if (dto.tripFuelKg != null) lines.push(`**Trip fuel**: ${dto.tripFuelKg} kg`);
    if (dto.altFuelKg != null) lines.push(`**Alternate fuel**: ${dto.altFuelKg} kg`);
    if (dto.contingencyPct != null) lines.push(`**Contingency**: ${dto.contingencyPct}%`);
    if (dto.contingencyFuelKg != null) lines.push(`**Contingency fuel**: ${dto.contingencyFuelKg} kg`);
    if (dto.reserveFuelKg != null) lines.push(`**Reserve fuel**: ${dto.reserveFuelKg} kg`);
    if (dto.fuelReserveMinutes != null) lines.push(`**Reserve time**: ${dto.fuelReserveMinutes} min`);
    if (dto.minFuelKg != null) lines.push(`**Minimum required fuel**: ${dto.minFuelKg} kg`);
    if (dto.fuelRequiredTotal != null) lines.push(`**Total required**: ${dto.fuelRequiredTotal} kg`);
    if (dto.enduranceMinutes != null) lines.push(`**Endurance**: ${dto.enduranceMinutes} min`);

    if (dto.callsign) lines.push('', `**Callsign**: ${dto.callsign}`);
    if (dto.remarks) lines.push('', `**Remarks**: ${dto.remarks.slice(0, 500)}`);

    return lines.join('\n');
  }

  private async callAiWithFallback(
    userId: string,
    userPrompt: string,
  ): Promise<string> {
    const byok = await this.getUserByokConfig(userId);

    if (byok) {
      try {
        const provider = this.getProvider(byok.provider);
        return await provider.generateCompletion(
          FLIGHT_PLAN_VALIDATION_SYSTEM_PROMPT,
          userPrompt,
          { apiKey: byok.apiKey, model: getDefaultModel(byok.provider) },
        );
      } catch (err) {
        this.logger.warn(
          `BYOK provider ${byok.provider} failed for user ${userId}, falling through to free tier: ${(err as Error).message}`,
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
        const result = await this.geminiProvider.generateCompletion(
          FLIGHT_PLAN_VALIDATION_SYSTEM_PROMPT,
          userPrompt,
          { apiKey: geminiKey, model: DEFAULT_MODELS.gemini as string },
        );
        await this.incrementRateLimit(userId);
        return result;
      } catch (err) {
        this.logger.warn(`Gemini free tier failed: ${(err as Error).message}`);
      }
    }

    const groqKey = this.config.get<string>('GROQ_API_KEY');
    if (groqKey) {
      try {
        const result = await this.groqProvider.generateCompletion(
          FLIGHT_PLAN_VALIDATION_SYSTEM_PROMPT,
          userPrompt,
          { apiKey: groqKey, model: DEFAULT_MODELS.groq as string },
        );
        await this.incrementRateLimit(userId);
        return result;
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
