-- IMP-06 · Asignar la plaza 2 después del primer inicio de sesión con Google de la segunda
-- persona (ARCH-01 §7, pasos 4 y 5; variante de la guía de IMP-01 que no requiere copiar UUID).
-- Ejecutar en el SQL Editor del proyecto como postgres, reemplazando <CORREO_PLAZA_2>.
-- Falla sin cambiar nada si la cuenta no existe, no es una identidad Google con correo
-- confirmado, ya ocupa una plaza o la plaza 2 pertenece a otra persona.
begin;
do $$
declare
  wanted constant text := lower(btrim('<CORREO_PLAZA_2>'));
  candidate uuid;
  identities integer;
begin
  select u.id into strict candidate
  from auth.users u
  where lower(u.email) = wanted and u.email_confirmed_at is not null;

  select count(*) into identities from auth.identities i where i.user_id = candidate;
  if identities <> 1 or not exists (select 1 from auth.identities i where i.user_id = candidate and i.provider = 'google') then
    raise exception 'La cuenta debe tener exactamente una identidad, de Google';
  end if;

  lock table private.members in share row exclusive mode;
  if exists (select 1 from private.members where owner_id = candidate) then
    raise exception 'La cuenta ya ocupa una plaza';
  end if;
  if exists (select 1 from private.members where slot = 2) then
    raise exception 'La plaza 2 ya está ocupada';
  end if;

  insert into private.members (slot, owner_id) values (2, candidate);
  -- La preferencia dispara la siembra de las 13 categorías iniciales.
  insert into app.preferences (owner_id) values (candidate) on conflict (owner_id) do nothing;
end;
$$;
delete from private.bootstrap_emails;
select (select count(*) from private.members) as plazas,
       (select count(*) from private.bootstrap_emails) as admision_pendiente;
commit;
-- Después: Authentication → Sign In / Providers → desactivar «Allow new users to sign up».
