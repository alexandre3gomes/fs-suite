-- Rename tables from PascalCase to snake_case
ALTER TABLE "User" RENAME TO "users";
ALTER TABLE "OAuthAccount" RENAME TO "oauth_accounts";
ALTER TABLE "Session" RENAME TO "sessions";
ALTER TABLE "AircraftProfile" RENAME TO "aircraft_profiles";
ALTER TABLE "Airport" RENAME TO "airports";
ALTER TABLE "Runway" RENAME TO "runways";
ALTER TABLE "FlightPlan" RENAME TO "flight_plans";
ALTER TABLE "FlightPlanRoute" RENAME TO "flight_plan_routes";
ALTER TABLE "IntegrationConnection" RENAME TO "integration_connections";
ALTER TABLE "ActivityLog" RENAME TO "activity_logs";
ALTER TABLE "VfrFlightPlan" RENAME TO "vfr_flight_plans";
ALTER TABLE "VfrFlightPlanVisualReference" RENAME TO "vfr_flight_plan_visual_references";
ALTER TABLE "VfrFlightPlanBriefingItem" RENAME TO "vfr_flight_plan_briefing_items";

-- Rename columns from camelCase to snake_case

-- users
ALTER TABLE "users" RENAME COLUMN "avatarUrl" TO "avatar_url";
ALTER TABLE "users" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "users" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "users" RENAME COLUMN "deletedAt" TO "deleted_at";

-- oauth_accounts
ALTER TABLE "oauth_accounts" RENAME COLUMN "providerAccountId" TO "provider_account_id";
ALTER TABLE "oauth_accounts" RENAME COLUMN "accessToken" TO "access_token";
ALTER TABLE "oauth_accounts" RENAME COLUMN "refreshToken" TO "refresh_token";
ALTER TABLE "oauth_accounts" RENAME COLUMN "expiresAt" TO "expires_at";
ALTER TABLE "oauth_accounts" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "oauth_accounts" RENAME COLUMN "userId" TO "user_id";

-- sessions
ALTER TABLE "sessions" RENAME COLUMN "refreshTokenHash" TO "refresh_token_hash";
ALTER TABLE "sessions" RENAME COLUMN "expiresAt" TO "expires_at";
ALTER TABLE "sessions" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "sessions" RENAME COLUMN "lastUsedAt" TO "last_used_at";
ALTER TABLE "sessions" RENAME COLUMN "userAgent" TO "user_agent";
ALTER TABLE "sessions" RENAME COLUMN "ipAddress" TO "ip_address";
ALTER TABLE "sessions" RENAME COLUMN "userId" TO "user_id";

-- aircraft_profiles
ALTER TABLE "aircraft_profiles" RENAME COLUMN "icaoType" TO "icao_type";
ALTER TABLE "aircraft_profiles" RENAME COLUMN "cruiseSpeed" TO "cruise_speed";
ALTER TABLE "aircraft_profiles" RENAME COLUMN "fuelUnit" TO "fuel_unit";
ALTER TABLE "aircraft_profiles" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "aircraft_profiles" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "aircraft_profiles" RENAME COLUMN "userId" TO "user_id";

-- runways
ALTER TABLE "runways" RENAME COLUMN "airportIcao" TO "airport_icao";
ALTER TABLE "runways" RENAME COLUMN "lengthFt" TO "length_ft";
ALTER TABLE "runways" RENAME COLUMN "widthFt" TO "width_ft";
ALTER TABLE "runways" RENAME COLUMN "surfaceType" TO "surface_type";
ALTER TABLE "runways" RENAME COLUMN "leIdent" TO "le_ident";
ALTER TABLE "runways" RENAME COLUMN "leHeadingDeg" TO "le_heading_deg";
ALTER TABLE "runways" RENAME COLUMN "leElevationFt" TO "le_elevation_ft";
ALTER TABLE "runways" RENAME COLUMN "heIdent" TO "he_ident";
ALTER TABLE "runways" RENAME COLUMN "heHeadingDeg" TO "he_heading_deg";
ALTER TABLE "runways" RENAME COLUMN "heElevationFt" TO "he_elevation_ft";

-- flight_plans
ALTER TABLE "flight_plans" RENAME COLUMN "flightType" TO "flight_type";
ALTER TABLE "flight_plans" RENAME COLUMN "plannedAltitude" TO "planned_altitude";
ALTER TABLE "flight_plans" RENAME COLUMN "simBriefOfpId" TO "simbrief_ofp_id";
ALTER TABLE "flight_plans" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "flight_plans" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "flight_plans" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "flight_plans" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "flight_plans" RENAME COLUMN "originIcao" TO "origin_icao";
ALTER TABLE "flight_plans" RENAME COLUMN "destinationIcao" TO "destination_icao";
ALTER TABLE "flight_plans" RENAME COLUMN "aircraftProfileId" TO "aircraft_profile_id";

-- flight_plan_routes
ALTER TABLE "flight_plan_routes" RENAME COLUMN "waypointIdent" TO "waypoint_ident";
ALTER TABLE "flight_plan_routes" RENAME COLUMN "flightPlanId" TO "flight_plan_id";

-- integration_connections
ALTER TABLE "integration_connections" RENAME COLUMN "externalId" TO "external_id";
ALTER TABLE "integration_connections" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "integration_connections" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "integration_connections" RENAME COLUMN "userId" TO "user_id";

-- activity_logs
ALTER TABLE "activity_logs" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "activity_logs" RENAME COLUMN "userId" TO "user_id";

-- vfr_flight_plans
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "flightRules" TO "flight_rules";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "originIcao" TO "origin_icao";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "originName" TO "origin_name";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "originElevationFt" TO "origin_elevation_ft";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "originRunwayInUse" TO "origin_runway_in_use";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "originMetarRaw" TO "origin_metar_raw";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "destinationIcao" TO "destination_icao";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "destinationName" TO "destination_name";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "destinationElevationFt" TO "destination_elevation_ft";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "destinationRunwayInUse" TO "destination_runway_in_use";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "destinationMetarRaw" TO "destination_metar_raw";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "alternateIcao" TO "alternate_icao";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "alternateName" TO "alternate_name";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "alternateElevationFt" TO "alternate_elevation_ft";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "alternateRunwayInUse" TO "alternate_runway_in_use";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "alternateMetarRaw" TO "alternate_metar_raw";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "aircraftType" TO "aircraft_type";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "aircraftName" TO "aircraft_name";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "takeoffWeightKg" TO "takeoff_weight_kg";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "mtowKg" TO "mtow_kg";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "simbriefOfpId" TO "simbrief_ofp_id";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "routeText" TO "route_text";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "cruiseLevel" TO "cruise_level";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "todMinutes" TO "tod_minutes";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "todDistanceNm" TO "tod_distance_nm";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "fuelConsumptionPerHour" TO "fuel_consumption_per_hour";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "fuelCurrentTotal" TO "fuel_current_total";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "fuelReserveMinutes" TO "fuel_reserve_minutes";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "fuelRequiredTotal" TO "fuel_required_total";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "fuelPerWing" TO "fuel_per_wing";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "enduranceMinutes" TO "endurance_minutes";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "vfr_flight_plans" RENAME COLUMN "deletedAt" TO "deleted_at";

-- vfr_flight_plan_visual_references
ALTER TABLE "vfr_flight_plan_visual_references" RENAME COLUMN "flightPlanId" TO "flight_plan_id";
ALTER TABLE "vfr_flight_plan_visual_references" RENAME COLUMN "distanceNm" TO "distance_nm";
ALTER TABLE "vfr_flight_plan_visual_references" RENAME COLUMN "timeMin" TO "time_min";

-- vfr_flight_plan_briefing_items
ALTER TABLE "vfr_flight_plan_briefing_items" RENAME COLUMN "flightPlanId" TO "flight_plan_id";
