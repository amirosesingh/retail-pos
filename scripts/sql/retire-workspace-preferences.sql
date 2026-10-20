-- Data-only cleanup: retain all other appearance, integration and selling settings.
-- Safe to repeat. No permissions, branches or terminal registrations are changed.
BEGIN;
UPDATE public.pos_settings
SET integration_settings = integration_settings - 'terminalPurpose' - 'terminalPurposeOverride'
WHERE integration_settings ?| ARRAY['terminalPurpose', 'terminalPurposeOverride'];
UPDATE public.settings_scoped
SET value = value - 'workspace'
WHERE key = 'personal_appearance' AND value ? 'workspace';
COMMIT;
