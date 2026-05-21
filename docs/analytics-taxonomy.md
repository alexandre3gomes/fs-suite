# Analytics Taxonomy

Structured event tracking for FS Suite, implemented via PostHog through `apps/app/src/services/analytics.ts`.

## Principles

1. **Generic event names with descriptive properties** — prefer `screen_viewed` + `screen: 'flight-plans'` over `flight_plans_screen_viewed`.
2. **Separate attempt / success / failure** — every meaningful action emits a `*_requested`, `*_succeeded`, and `*_failed` triplet so funnels are accurate.
3. **No personally identifiable or free-form content** — never send raw METAR text, route notes, user names, OFP HTML, or any free input. Identify the user by ID + email/name once via `identifyUser()`; do not re-attach them to events.
4. **Opt-out respected** — initialization is gated by `analytics_opt_out` flag in AsyncStorage. Toggle in Profile > Privacy.
5. **Dev mode disabled** — `__DEV__` short-circuits init.

## Base context (auto-attached to every event)

- `platform` — `ios | android | web`
- `locale` — device locale
- `app_version` — from `expo.version`
- `authenticated` — current auth state
- `feature` / `subfeature` — set by `setFeatureContext()` per screen
- `$current_url` — on web only

## Events

### Auth (`feature: auth`)

| Event | Trigger | Key properties |
|---|---|---|
| `screen_viewed` | login screen mounts | `screen` |
| `auth_providers_loaded` | `/auth/providers` succeeded | `provider_count` |
| `auth_sign_in_started` | user clicks sign-in button | `provider: google\|dev` |
| `auth_sign_in_completed` | sign-in flow returned a session | `provider` |
| `auth_sign_in_failed` | sign-in threw | `provider`, `error_type`, `status_code` |

### Navigation (root)

| Event | Trigger | Key properties |
|---|---|---|
| `screen_viewed` | route changes (Expo Router pathname) | `screen` (path) |
| `cta_clicked` | major navigation CTAs | `cta`, `from` |

### Flight plans (`feature: flight_plans` / `vfr_planning`)

| Event | Trigger | Key properties |
|---|---|---|
| `flight_plan_list_viewed` | list endpoint returned | `plan_count`, `is_empty` |
| `flight_plan_opened` | user opens an existing plan | `plan_id`, `status`, `flight_rules`, `from` |
| `flight_plan_save_requested` | save button clicked | `plan_mode: create\|edit`, `flight_rules`, `origin_icao`, `destination_icao`, `has_alternate`, `has_route`, `has_simbrief`, `aircraft_type` |
| `flight_plan_created` | POST `/flight-plans` succeeded | `plan_id`, `flight_rules`, `origin_icao`, `destination_icao`, `has_alternate` |
| `flight_plan_updated` | PATCH `/flight-plans/:id` succeeded | `plan_id`, `flight_rules` |
| `flight_plan_save_failed` | save threw | `plan_mode`, `plan_id?`, `error_type`, `status_code` |
| `flight_plan_delete_requested` | delete confirmed | `plan_id` |
| `flight_plan_deleted` | delete succeeded | `plan_id` |
| `flight_plan_delete_failed` | delete threw | `plan_id`, `error_type`, `status_code` |

### Charts (`feature: vfr_planning`)

| Event | Trigger | Key properties |
|---|---|---|
| `chart_viewed` | selected chart rendered in viewer | `icao`, `chart_type` (ADC/PDC/VAC/…), `source` |

### Export (`feature: vfr_planning`)

| Event | Trigger | Key properties |
|---|---|---|
| `export_modal_opened` | PDF export button clicked | `origin_icao`, `destination_icao` |
| `export_requested` | confirm clicked, options finalized | `includes_charts`, `includes_checklist`, `includes_ai`, `has_map_image` |
| `export_completed` | export finished | same as `export_requested` + `attachment_count` |
| `export_failed` | export threw | `error_type`, `status_code` |

### AI validation (`feature: ai_review`)

| Event | Trigger | Key properties |
|---|---|---|
| `ai_validation_opened` | user opens AI validation modal | `has_previous_result` |
| `ai_validation_requested` | request fired to `/ai-validation/validate` | `origin_icao`, `destination_icao`, `flight_rules` |
| `ai_validation_succeeded` | response parsed | `overall_status: pass\|warnings\|issues`, `provider`, `has_byok` |
| `ai_validation_failed` | request threw | `error_type`, `status_code`, `rate_limited` |
| `ai_validation_blocked_missing_inputs` | requirements not met | — |

### SimBrief (`feature: simbrief`)

| Event | Trigger | Key properties |
|---|---|---|
| `simbrief_dispatch_opened` | user opens SimBrief dispatch in new tab | `origin_icao`, `destination_icao`, `has_alternate`, `has_aircraft`, `has_callsign` |
| `simbrief_import_requested` | user clicks import OFP | — |
| `simbrief_import_succeeded` | OFP imported | `origin_icao`, `destination_icao`, `has_alternate` |
| `simbrief_import_failed` | import threw | `error_type`, `status_code` |
| `simbrief_pilot_id_saved` | profile: pilot ID saved | — |
| `simbrief_pilot_id_save_failed` | save threw | `error_type`, `status_code` |

### Profile (`feature: profile`)

| Event | Trigger | Key properties |
|---|---|---|
| `ai_key_saved` | BYOK key saved | `provider` |
| `ai_key_save_failed` | save threw | `provider`, `error_type`, `status_code` |
| `ai_key_deleted` | BYOK key deleted | — |
| `analytics_opt_in` | user re-enables analytics | — |

## Privacy / LGPD checklist

For every event, ask:

1. Does it contain free-form user input? → **drop** (route remarks, METAR raw, OFP HTML, plan names).
2. Does it contain identifiable user data outside `identify()`? → **drop** (email, full name).
3. Is the property necessary to answer a product question? → if not, drop.
4. Can a flag/code replace a raw string? → prefer flags (`has_alternate: boolean` over `alternate_icao` when the ICAO isn't needed for the analysis).

ICAO codes for origin/destination are aggregated codes (not PII) and acceptable. Plan IDs are server-generated identifiers and acceptable.

## KPIs to watch

- **Auth funnel**: `auth_sign_in_started` → `auth_sign_in_completed` (by provider)
- **Planner funnel**: `flight_plan_save_requested` → `flight_plan_created`/`updated` vs `flight_plan_save_failed`
- **Engagement**: `flight_plan_created` → `flight_plan_opened` (reopen rate)
- **Charts adoption**: `chart_viewed` per active user
- **AI adoption**: `ai_validation_opened` → `ai_validation_succeeded` (by `has_byok`)
- **Export adoption**: % of saved plans that emit `export_completed`
- **SimBrief**: pilot IDs saved vs successful imports per user
