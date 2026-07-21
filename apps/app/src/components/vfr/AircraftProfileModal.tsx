import type { AircraftCatalogEntry, CreateAircraftProfileInput, UpdateAircraftProfileInput, UserAircraftProfile, WeightStation } from '@fs-suite/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Dropdown } from 'react-native-element-dropdown';

import { confirmDialog } from '../../lib/notify';
import { apiClient } from '../../services/api.client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  editingProfile?: UserAircraftProfile | null;
  catalog: AircraftCatalogEntry[];
  shared?: UserAircraftProfile[];
  preselectedBaseId?: string | null;
  onClose: () => void;
  onSaved: (profile: UserAircraftProfile) => void;
  onDeleted?: (profileId: string) => void;
}

type Step = 'pick-base' | 'form';

interface FormState {
  name: string;
  icaoType: string;
  manufacturer: string;
  model: string;
  emptyWeightKg: string;
  mtowKg: string;
  fuelCapacityL: string;
  fuelBurnLph: string;
  cruiseSpeedKts: string;
  climbSpeedKts: string;
  climbRateFpm: string;
  descentSpeedKts: string;
  descentRateFpm: string;
  isShared: boolean;
  stations: WeightStation[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyForm(): FormState {
  return {
    name: '', icaoType: '', manufacturer: '', model: '',
    emptyWeightKg: '', mtowKg: '', fuelCapacityL: '', fuelBurnLph: '',
    cruiseSpeedKts: '', climbSpeedKts: '', climbRateFpm: '',
    descentSpeedKts: '', descentRateFpm: '',
    isShared: false, stations: [],
  };
}

function profileToForm(p: UserAircraftProfile): FormState {
  return {
    name: p.name, icaoType: p.icaoType ?? '', manufacturer: p.manufacturer ?? '', model: p.model ?? '',
    emptyWeightKg: p.emptyWeightKg != null ? String(p.emptyWeightKg) : '',
    mtowKg: p.mtowKg != null ? String(p.mtowKg) : '',
    fuelCapacityL: p.fuelCapacityL != null ? String(p.fuelCapacityL) : '',
    fuelBurnLph: p.fuelBurnLph != null ? String(p.fuelBurnLph) : '',
    cruiseSpeedKts: p.cruiseSpeedKts != null ? String(p.cruiseSpeedKts) : '',
    climbSpeedKts: p.climbSpeedKts != null ? String(p.climbSpeedKts) : '',
    climbRateFpm: p.climbRateFpm != null ? String(p.climbRateFpm) : '',
    descentSpeedKts: p.descentSpeedKts != null ? String(p.descentSpeedKts) : '',
    descentRateFpm: p.descentRateFpm != null ? String(p.descentRateFpm) : '',
    isShared: p.isShared, stations: p.stations ?? [],
  };
}

function catalogToForm(e: AircraftCatalogEntry): FormState {
  return {
    name: e.name, icaoType: e.icaoType ?? '', manufacturer: e.manufacturer ?? '', model: e.model ?? '',
    emptyWeightKg: e.emptyWeightKg != null ? String(e.emptyWeightKg) : '',
    mtowKg: e.mtowKg != null ? String(e.mtowKg) : '',
    fuelCapacityL: e.fuelCapacityL != null ? String(e.fuelCapacityL) : '',
    fuelBurnLph: e.fuelBurnLph != null ? String(e.fuelBurnLph) : '',
    cruiseSpeedKts: e.cruiseSpeedKts != null ? String(e.cruiseSpeedKts) : '',
    climbSpeedKts: '',
    climbRateFpm: '',
    descentSpeedKts: '',
    descentRateFpm: '',
    isShared: false, stations: e.stations ?? [],
  };
}

function parseNum(s: string): number | undefined {
  const n = parseFloat(s.replace(',', '.'));
  return isNaN(n) || n <= 0 ? undefined : n;
}

function parseIntNum(s: string): number | undefined {
  const n = parseInt(s, 10);
  return isNaN(n) || n <= 0 ? undefined : n;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Field({
  label, value, onChange, keyboardType = 'default', placeholder, required, maxLength,
}: {
  label: string; value: string; onChange: (v: string) => void;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  placeholder?: string; required?: boolean; maxLength?: number;
}) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>
        {label}{required ? ' *' : ''}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        maxLength={maxLength}
        autoCapitalize={maxLength === 4 ? 'characters' : 'sentences'}
        style={{
          borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8,
          paddingHorizontal: 10, paddingVertical: 7,
          fontSize: 14, color: '#1a1d26', backgroundColor: '#fff',
        }}
      />
    </View>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: 10 }}>{children}</View>;
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text style={{ fontSize: 10, fontWeight: '700', color: '#9ca3af', letterSpacing: 0.8, marginBottom: 6, marginTop: 12 }}>
      {children.toUpperCase()}
    </Text>
  );
}

const STATION_PRESETS = [
  { id: 'pilot', label: 'Piloto', labelKey: 'aircraft.pilot' },
  { id: 'copilot', label: 'Copiloto', labelKey: 'aircraft.copilot' },
  { id: 'rearPax', label: 'Pax Traseiro', labelKey: 'aircraft.rearPax' },
  { id: 'rearPax2', label: 'Pax Traseiro 2', labelKey: 'aircraft.rearPax2' },
  { id: 'baggage', label: 'Bagagem', labelKey: 'aircraft.baggage' },
  { id: 'baggage2', label: 'Bagagem 2', labelKey: 'aircraft.baggage2' },
];

function StationRow({ station, onChange, onRemove }: {
  station: WeightStation; onChange: (s: WeightStation) => void; onRemove: () => void;
}) {
  const label = STATION_PRESETS.find((p) => p.id === station.id)?.label ?? station.id;
  return (
    <View style={{ marginBottom: 6, padding: 8, backgroundColor: '#f9fafb', borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: '#374151' }}>{label}</Text>
        <Pressable onPress={onRemove} hitSlop={8}>
          <Text style={{ fontSize: 13, color: '#dc2626' }}>✕</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[
          { key: 'defaultKg' as const, label: 'Padrão kg' },
          { key: 'maxKg' as const, label: 'Máx kg' },
          { key: 'arm' as const, label: 'Braço m' },
        ].map(({ key, label: lbl }) => (
          <View key={key} style={{ flex: 1 }}>
            <Text style={{ fontSize: 9, color: '#6b7280', marginBottom: 2 }}>{lbl}</Text>
            <TextInput
              value={String(station[key])}
              onChangeText={(v) => onChange({ ...station, [key]: parseFloat(v) || 0 })}
              keyboardType="decimal-pad"
              style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6, padding: 5, fontSize: 13, backgroundColor: '#fff', textAlign: 'center' }}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AircraftProfileModal({ visible, editingProfile, catalog, shared = [], preselectedBaseId, onClose, onSaved, onDeleted }: Props) {
  const isEditing = editingProfile != null;
  const [step, setStep] = useState<Step>(isEditing ? 'form' : 'pick-base');
  const [form, setForm] = useState<FormState>(isEditing ? profileToForm(editingProfile!) : emptyForm());
  const [pickBaseSelected, setPickBaseSelected] = useState<string | null>(preselectedBaseId ?? null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDirtyRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    isDirtyRef.current = false;
    if (isEditing) {
      setStep('form');
      setForm(profileToForm(editingProfile!));
    } else {
      setStep('pick-base');
      setForm(emptyForm());
      setPickBaseSelected(preselectedBaseId ?? null);
    }
  }, [visible, isEditing, editingProfile, preselectedBaseId]);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    isDirtyRef.current = true;
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const requestClose = useCallback(() => {
    if (!isDirtyRef.current) { onClose(); return; }
    confirmDialog({
      title: 'Descartar alterações?',
      message: 'Você tem alterações não salvas. Ao fechar, elas serão perdidas.',
      confirmLabel: 'Descartar',
      destructive: true,
      onConfirm: onClose,
    });
  }, [onClose]);

  const handlePickBase = useCallback((entry: AircraftCatalogEntry | UserAircraftProfile | 'blank') => {
    isDirtyRef.current = false;
    if (entry === 'blank') {
      setForm(emptyForm());
    } else if (entry.isTemplate) {
      setForm(catalogToForm(entry));
    } else {
      setForm({ ...profileToForm(entry), isShared: false });
    }
    setStep('form');
  }, []);

  const addStation = useCallback((preset: (typeof STATION_PRESETS)[number]) => {
    setForm((prev) => {
      if (prev.stations.some((s) => s.id === preset.id)) return prev;
      return { ...prev, stations: [...prev.stations, { id: preset.id, labelKey: preset.labelKey, defaultKg: 0, maxKg: 150, arm: 1.0 }] };
    });
  }, []);

  const updateStation = useCallback((idx: number, s: WeightStation) => {
    setForm((prev) => { const stations = [...prev.stations]; stations[idx] = s; return { ...prev, stations }; });
  }, []);

  const removeStation = useCallback((idx: number) => {
    setForm((prev) => ({ ...prev, stations: prev.stations.filter((_, i) => i !== idx) }));
  }, []);

  const handleSave = useCallback(async () => {
    setError(null);
    if (!form.icaoType.trim()) { setError('Código ICAO é obrigatório'); return; }
    if (!form.name.trim()) { setError('Nome é obrigatório'); return; }
    setSaving(true);
    try {
      const payload: CreateAircraftProfileInput | UpdateAircraftProfileInput = {
        name: form.name.trim(),
        icaoType: form.icaoType.trim().toUpperCase(),
        manufacturer: form.manufacturer.trim() || undefined,
        model: form.model.trim() || undefined,
        emptyWeightKg: parseNum(form.emptyWeightKg),
        mtowKg: parseNum(form.mtowKg),
        fuelCapacityL: parseNum(form.fuelCapacityL),
        fuelBurnLph: parseNum(form.fuelBurnLph),
        cruiseSpeedKts: parseIntNum(form.cruiseSpeedKts),
        climbSpeedKts: parseIntNum(form.climbSpeedKts),
        climbRateFpm: parseIntNum(form.climbRateFpm),
        descentSpeedKts: parseIntNum(form.descentSpeedKts),
        descentRateFpm: parseIntNum(form.descentRateFpm),
        isShared: form.isShared,
        stations: form.stations.length > 0 ? form.stations : undefined,
      };
      const saved: UserAircraftProfile = isEditing
        ? await apiClient.patch<UserAircraftProfile>(`/aircraft-profiles/${editingProfile!.id}`, payload)
        : await apiClient.post<UserAircraftProfile>('/aircraft-profiles', payload);
      onSaved(saved);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar perfil');
    } finally {
      setSaving(false);
    }
  }, [form, isEditing, editingProfile, onSaved, onClose]);

  const handleDelete = useCallback(async () => {
    if (!editingProfile) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/aircraft-profiles/${editingProfile.id}`);
      onDeleted?.(editingProfile.id);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir perfil');
      setDeleting(false);
    }
  }, [editingProfile, onDeleted, onClose]);

  const title = isEditing
    ? 'Editar perfil de aeronave'
    : step === 'pick-base'
    ? 'Novo perfil de aeronave'
    : 'Configurar perfil';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={requestClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 }}
          onPress={requestClose}
        >
          {/* Inner card — absorbs touches so tapping inside doesn't close */}
          <Pressable
            style={{ width: '100%', maxWidth: 520, maxHeight: '88%', borderRadius: 14, overflow: 'hidden', backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } }}
            onPress={() => {}}
          >
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}>
              {step === 'form' && !isEditing ? (
                <Pressable onPress={() => setStep('pick-base')} style={{ marginRight: 10 }} hitSlop={8}>
                  <Text style={{ fontSize: 20, color: '#6b7280', lineHeight: 22 }}>‹</Text>
                </Pressable>
              ) : null}
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#1a1d26', flex: 1 }}>{title}</Text>
              <Pressable onPress={requestClose} hitSlop={8}>
                <Text style={{ fontSize: 18, color: '#9ca3af' }}>✕</Text>
              </Pressable>
            </View>

            {/* Body */}
            <ScrollView
              contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {step === 'pick-base' ? (
                <PickBaseStep
                  catalog={catalog}
                  shared={shared}
                  selected={pickBaseSelected}
                  onSelect={setPickBaseSelected}
                  onPick={handlePickBase}
                />
              ) : (
                <FormStep
                  form={form} set={set}
                  addStation={addStation} updateStation={updateStation} removeStation={removeStation}
                  isEditing={isEditing} saving={saving} deleting={deleting} error={error}
                  onSave={handleSave} onDelete={handleDelete}
                />
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Step: pick base ──────────────────────────────────────────────────────────

function PickBaseStep({ catalog, shared, selected, onSelect, onPick }: {
  catalog: AircraftCatalogEntry[];
  shared: UserAircraftProfile[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onPick: (e: AircraftCatalogEntry | UserAircraftProfile | 'blank') => void;
}) {
  const data = [
    ...catalog
      .filter((a) => a.icaoType != null)
      .map((a) => ({
        label: `${a.icaoType} — ${a.manufacturer ?? ''} ${a.model ?? a.name}`.trim(),
        value: a.id,
        entry: a as AircraftCatalogEntry | UserAircraftProfile,
      })),
    ...shared
      .filter((s) => s.icaoType != null)
      .map((s) => ({
        label: `${s.icaoType} — ${s.name} (Compartilhado)`,
        value: s.id,
        entry: s as AircraftCatalogEntry | UserAircraftProfile,
      })),
  ];

  const chosenEntry = data.find((c) => c.value === selected)?.entry;

  return (
    <View>
      <Text style={{ fontSize: 13, color: '#6b7280', marginBottom: 14, lineHeight: 19 }}>
        Escolha uma aeronave do catálogo ou um perfil compartilhado para pré-preencher os dados, ou comece do zero.
      </Text>

      <Text style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>Aeronave base</Text>
      <Dropdown
        data={data}
        labelField="label"
        valueField="value"
        searchField="label"
        value={selected}
        onChange={(item) => onSelect(item.value)}
        search
        searchPlaceholder="Buscar aeronave..."
        placeholder="Selecionar aeronave base (opcional)..."
        style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' }}
        placeholderStyle={{ fontSize: 14, color: '#9ca3af' }}
        selectedTextStyle={{ fontSize: 14, color: '#1a1d26' }}
        inputSearchStyle={{ fontSize: 14, borderColor: '#e5e7eb', borderRadius: 6, paddingHorizontal: 8, height: 36 }}
        containerStyle={{ borderRadius: 8, borderColor: '#e5e7eb', overflow: 'hidden', elevation: 4 }}
        maxHeight={240}
      />

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
        <Pressable
          onPress={() => onPick('blank')}
          style={{ flex: 1, padding: 12, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, alignItems: 'center' }}
        >
          <Text style={{ fontSize: 14, color: '#374151', fontWeight: '600' }}>Começar em branco</Text>
        </Pressable>
        <Pressable
          onPress={() => { if (chosenEntry) onPick(chosenEntry); }}
          style={{ flex: 1, padding: 12, borderRadius: 8, alignItems: 'center', backgroundColor: chosenEntry ? '#2563eb' : '#e5e7eb' }}
        >
          <Text style={{ fontSize: 14, color: chosenEntry ? '#fff' : '#9ca3af', fontWeight: '600' }}>
            Usar como base
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Step: form ───────────────────────────────────────────────────────────────

function FormStep({ form, set, addStation, updateStation, removeStation, isEditing, saving, deleting, error, onSave, onDelete }: {
  form: FormState;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  addStation: (p: (typeof STATION_PRESETS)[number]) => void;
  updateStation: (idx: number, s: WeightStation) => void;
  removeStation: (idx: number) => void;
  isEditing: boolean; saving: boolean; deleting: boolean; error: string | null;
  onSave: () => void; onDelete: () => void;
}) {
  const availablePresets = STATION_PRESETS.filter((p) => !form.stations.some((s) => s.id === p.id));

  return (
    <View>
      <SectionTitle>Identificação</SectionTitle>
      <Row2>
        <View style={{ flex: 1 }}>
          <Field label="Código ICAO" value={form.icaoType} onChange={(v) => set('icaoType', v.toUpperCase())} placeholder="C172" required maxLength={4} />
        </View>
        <View style={{ flex: 2 }}>
          <Field label="Nome do perfil" value={form.name} onChange={(v) => set('name', v)} placeholder="Meu Cessna 172" required />
        </View>
      </Row2>
      <Row2>
        <View style={{ flex: 1 }}>
          <Field label="Fabricante" value={form.manufacturer} onChange={(v) => set('manufacturer', v)} placeholder="Cessna" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Modelo" value={form.model} onChange={(v) => set('model', v)} placeholder="172S Skyhawk SP" />
        </View>
      </Row2>

      <SectionTitle>Pesos</SectionTitle>
      <Row2>
        <View style={{ flex: 1 }}>
          <Field label="Peso vazio (kg)" value={form.emptyWeightKg} onChange={(v) => set('emptyWeightKg', v)} keyboardType="decimal-pad" placeholder="767" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="MTOW (kg)" value={form.mtowKg} onChange={(v) => set('mtowKg', v)} keyboardType="decimal-pad" placeholder="1111" />
        </View>
      </Row2>

      <SectionTitle>Cruzeiro</SectionTitle>
      <Row2>
        <View style={{ flex: 1 }}>
          <Field label="Velocidade (kt)" value={form.cruiseSpeedKts} onChange={(v) => set('cruiseSpeedKts', v)} keyboardType="numeric" placeholder="124" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Consumo (L/h)" value={form.fuelBurnLph} onChange={(v) => set('fuelBurnLph', v)} keyboardType="decimal-pad" placeholder="34" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Combustível (L)" value={form.fuelCapacityL} onChange={(v) => set('fuelCapacityL', v)} keyboardType="decimal-pad" placeholder="212" />
        </View>
      </Row2>

      <SectionTitle>Subida</SectionTitle>
      <Row2>
        <View style={{ flex: 1 }}>
          <Field label="Velocidade (kt)" value={form.climbSpeedKts} onChange={(v) => set('climbSpeedKts', v)} keyboardType="numeric" placeholder="74" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Taxa (fpm)" value={form.climbRateFpm} onChange={(v) => set('climbRateFpm', v)} keyboardType="numeric" placeholder="730" />
        </View>
      </Row2>

      <SectionTitle>Descida</SectionTitle>
      <Row2>
        <View style={{ flex: 1 }}>
          <Field label="Velocidade (kt)" value={form.descentSpeedKts} onChange={(v) => set('descentSpeedKts', v)} keyboardType="numeric" placeholder="100" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Taxa (fpm)" value={form.descentRateFpm} onChange={(v) => set('descentRateFpm', v)} keyboardType="numeric" placeholder="500" />
        </View>
      </Row2>

      <SectionTitle>Peso e balanceamento</SectionTitle>
      {form.stations.map((s, idx) => (
        <StationRow key={s.id} station={s} onChange={(updated) => updateStation(idx, updated)} onRemove={() => removeStation(idx)} />
      ))}
      {availablePresets.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
          {availablePresets.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => addStation(p)}
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#f9fafb' }}
            >
              <Text style={{ fontSize: 12, color: '#374151' }}>+ {p.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <SectionTitle>Compartilhamento</SectionTitle>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: 10, backgroundColor: '#f9fafb', borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb' }}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <Text style={{ fontSize: 13, color: '#374151', fontWeight: '500' }}>Compartilhar perfil</Text>
          <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
            Visível para todos os pilotos na lista de aeronaves
          </Text>
        </View>
        <Switch
          value={form.isShared}
          onValueChange={(v) => set('isShared', v)}
          trackColor={{ false: '#e5e7eb', true: '#2563eb' }}
          thumbColor="#fff"
        />
      </View>

      {error ? (
        <View style={{ padding: 10, backgroundColor: '#fef2f2', borderRadius: 8, borderWidth: 1, borderColor: '#fecaca', marginBottom: 10 }}>
          <Text style={{ fontSize: 13, color: '#dc2626' }}>{error}</Text>
        </View>
      ) : null}

      <Pressable
        onPress={onSave}
        disabled={saving}
        style={{ backgroundColor: '#2563eb', padding: 13, borderRadius: 10, alignItems: 'center', marginBottom: isEditing ? 4 : 8 }}
      >
        {saving
          ? <ActivityIndicator color="#fff" />
          : <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>{isEditing ? 'Salvar alterações' : 'Criar perfil'}</Text>}
      </Pressable>

      {isEditing ? (
        <Pressable onPress={onDelete} disabled={deleting} style={{ padding: 10, alignItems: 'center', marginBottom: 4 }}>
          {deleting
            ? <ActivityIndicator color="#dc2626" />
            : <Text style={{ fontSize: 13, color: '#dc2626' }}>Excluir perfil</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}
