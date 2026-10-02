-- Configure this deployment's existing public routes without replacing any
-- value an administrator has already saved in System & Integrations.
update public.pos_settings
set integration_settings = jsonb_set(
  jsonb_set(
    coalesce(integration_settings, '{}'::jsonb),
    '{memberDomain}',
    to_jsonb(
      case
        when btrim(coalesce(integration_settings->>'memberDomain', '')) = ''
          then 'https://member.luckycharmsdnbhd.com'
        else integration_settings->>'memberDomain'
      end
    ),
    true
  ),
  '{redeemDomain}',
  to_jsonb(
    case
      when btrim(coalesce(integration_settings->>'redeemDomain', '')) = ''
        then 'https://redeem.luckycharmsdnbhd.com'
      else integration_settings->>'redeemDomain'
    end
  ),
  true
)
where btrim(coalesce(integration_settings->>'memberDomain', '')) = ''
   or btrim(coalesce(integration_settings->>'redeemDomain', '')) = '';

comment on column public.pos_settings.integration_settings is
  'System integration configuration; public member/redeem domains remain administrator-editable.';
