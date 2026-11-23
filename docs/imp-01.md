# IMP-01 · Configuración y pruebas del acceso privado

## Proyecto alojado de desarrollo

1. Usar `cifra-development` en Supabase con una región cercana, separado de cualquier proyecto productivo. Revisar su referencia e inventario de tablas e identidades antes de aplicar la migración. Un proyecto de prueba debe contener solo identidades y datos ficticios.
2. En **Authentication → Configuration**, mantener cerradas las altas durante la preparación. Deshabilitar correo, teléfono, anónimos, vinculación manual y cualquier proveedor distinto de Google.
3. En un entorno de desarrollo nuevo, ejecutar `npm run test:db` antes de aplicar las migraciones. Con una CLI autorizada, enlazar la referencia de desarrollo, revisar `supabase db push --dry-run` y aplicar las versiones faltantes. En `cifra-development` ya constan [la base de seguridad](../supabase/migrations/20261123215123_security.sql) y [la corrección de permisos](../supabase/migrations/20261123222557_restrict_api_rpc_grants.sql). La versión local anterior se renombró tras comparar su SQL con el historial alojado.
4. En **Data API**, dejar `api` como único esquema expuesto y quitar `public` y `graphql_public` de los esquemas expuestos y de la ruta de búsqueda adicional. Mantener deshabilitado GraphQL. La migración revoca el uso de `graphql_public` para clientes si el esquema existe. Confirmar por HTTP que el endpoint GraphQL está cerrado. [Ajustes de seguridad de la Data API](https://supabase.com/docs/guides/api/securing-your-api)

## OAuth y habilitación controlada

1. En Google Cloud, registrar un cliente OAuth de tipo **Aplicación web** para desarrollo. Configurar la pantalla de consentimiento y las cuentas de prueba. Autorizar el origen `http://localhost:5173` y, en **URI de redirección autorizados**, pegar exactamente el callback indicado en el proveedor Google del panel de Supabase, normalmente `https://<REF_DE_DESARROLLO>.supabase.co/auth/v1/callback`. [Configuración de Google en Supabase](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)
2. En Supabase, habilitar solo Google y guardar el ID y el secreto OAuth en ese proveedor. Configurar `http://localhost:5173` como **Site URL** y registrar `http://localhost:5173/auth/callback` en **Redirect URLs**. Para otro entorno de prueba registrar su origen y su callback exactos.
3. Completar `.env.local` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` del proyecto de desarrollo. Las variables `VITE_*` se publican en el bundle. El secreto Google permanece en Supabase.
4. En **Authentication → Hooks**, habilitar **Before User Created** con el tipo Postgres y la función `private.before_user_created`. Comprobar que las altas siguen cerradas. Desde el editor SQL administrativo, cargar exactamente los dos correos de prueba, recortados y en minúsculas, en `private.bootstrap_emails`. Habilitar altas durante el alta controlada. [Contrato del hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook)
5. Completar OAuth con cada cuenta Google de prueba. Mientras una identidad carezca de plaza, Cifra muestra acceso denegado. En Supabase verificar el UUID de Auth, el proveedor Google, su identificador de proveedor y el correo confirmado esperado. Investigar cualquier identidad preexistente o vinculación inesperada antes de habilitarla.
6. Con los dos UUID verificados, deshabilitar las nuevas altas en **Authentication**. Ejecutar este SQL como operador, sustituyendo ambos UUID en el editor privado. La transacción preserva preferencias previas y falla si se intenta reasignar una plaza ocupada. Mantener el hook activo y la lista temporal vacía.

```sql
begin;
do $$
declare
  owner_a uuid := '<UUID_GOOGLE_VERIFICADO_A>';
  owner_b uuid := '<UUID_GOOGLE_VERIFICADO_B>';
begin
  if owner_a = owner_b then
    raise exception 'Se requieren dos identidades distintas';
  end if;
  lock table private.members in share row exclusive mode;
  if exists (
    select 1 from private.members
    where (slot = 1 and owner_id <> owner_a) or (slot = 2 and owner_id <> owner_b)
  ) then
    raise exception 'Una plaza ya corresponde a otra identidad';
  end if;

  insert into private.members (slot, owner_id) values (1, owner_a), (2, owner_b)
    on conflict (slot) do nothing;
  insert into app.preferences (owner_id) values (owner_a), (owner_b)
    on conflict (owner_id) do nothing;
end;
$$;
delete from private.bootstrap_emails;
commit;
```

Los UUID, los correos y los tokens son datos operativos de cada entorno. Mantenerlos fuera de Git y de los resultados de prueba compartidos. Conservar el registro administrativo de las dos plazas para sustituciones futuras.

## Verificación local

| Comando | Cobertura |
| --- | --- |
| `npm ci`, `npm run lint`, `npm test`, `npm run build` | Instalación desde el lockfile, lint, build, configuración del cliente y estados del callback. |
| `npm run test:db` | Ejecuta la migración desde cero en PostgreSQL embebido con el contrato mínimo de Auth simulado. Verifica permisos, RLS, aislamiento de preferencias, admisión y sesión exacta revocada. Funciona sin Docker. |
| `npm run test:e2e` | Playwright abre el build con respuestas simuladas de Auth y Data API. Cubre la navegación, los estados de acceso, la renovación y el cierre reintentable. Genera capturas del login y del layout a 1440, 834 y 375 px. |

Para Playwright, usar Chromium instalado mediante `npx playwright install chromium` o la variable `CIFRA_CHROMIUM_PATH` con la ruta de un Chrome local.

## Aceptación con cuentas y Data API reales

1. Cuando estén disponibles B y el tercero, usar perfiles de navegador separados. Con las altas cerradas, comprobar que el primer OAuth de la cuenta externa se rechaza y que el recuento de identidades de Auth se conserva. En la ventana controlada, verificar también que el hook rechaza un correo Google fuera de la lista. Para probar una identidad existente sin plaza, admitir al tercero de manera controlada sin asignarle plaza; retirar su correo de la lista, cerrar las altas y verificar que Auth lo reconoce y ambos RPC devuelven 403. Habilitar a B en la plaza libre conservando la plaza y las preferencias de A. Mantener la lista de preadmisión vacía al terminar.
2. Entrar de nuevo con A y B desde perfiles separados. Verificar callback, renovación real, cierre y retorno a login. Anotar resultados de las pruebas sin registrar correos, códigos OAuth ni tokens.
3. Ejecutar `npm run test:integration` contra `cifra-development` con las siguientes variables de entorno. También se puede ejecutar `node --env-file=.env.integration.local --test tests/integration/private-access.test.js`; el archivo local está ignorado por Git. Usar sesiones dedicadas de los perfiles de prueba y evitar cambios simultáneos de preferencias durante el ensayo. La suite corre las pruebas públicas con la URL y la clave publicable, y ejecuta cada caso autenticado según las sesiones disponibles.

   | Variable | Valor |
   | --- | --- |
   | `CIFRA_RUN_HOSTED_TESTS` | `1` para habilitar el ensayo alojado. |
   | `CIFRA_TEST_SUPABASE_URL` | `https://ljbrukrakumuatjnwxwd.supabase.co`. |
   | `CIFRA_TEST_SUPABASE_PUBLISHABLE_KEY` | Clave publicable del mismo proyecto. |
   | `CIFRA_TEST_ACCESS_TOKEN_A`, `CIFRA_TEST_ACCESS_TOKEN_B` | JWT de las sesiones de A y B. A basta para probar las preferencias propias. El aislamiento requiere ambos JWT. |
   | `CIFRA_TEST_ACCESS_TOKEN_OUTSIDER` | JWT de la identidad Google que carece de plaza. |
   | `CIFRA_TEST_EXPIRED_ACCESS_TOKEN` | JWT anterior de prueba que haya vencido naturalmente. Sin este valor, se omite solo el caso de expiración real. |
   | `CIFRA_TEST_REVOKE_SESSION_A` | `1` para cerrar la sesión dedicada de A y comprobar el rechazo inmediato de su JWT vigente. |

4. En el SQL Editor, auditar el esquema alojado de acuerdo con [ARCH-01 §14](arquitectura-v1.md#14-estrategia-de-pruebas). Confirmar que `private.allowed()` tiene propietario `postgres`, cero argumentos, `SECURITY DEFINER`, `STABLE` y `search_path` vacío. Confirmar que el propietario puede leer las columnas `id` y `user_id` de `auth.sessions` y que los clientes no pueden. Revisar los privilegios con `has_schema_privilege`, `has_function_privilege`, `has_table_privilege` y `has_column_privilege`. Los únicos RPC expuestos deben ser `get_preferences()` y `set_currency(text)`, ambos invocadores. Revisar `pg_policies` para los filtros por plaza, sesión y propietario y comprobar que la baja de una plaza deniega un JWT aún válido.
5. Comprobar también el retorno de foco del menú y el flujo de OAuth en un teléfono físico. Cerrar IMP-01 cuando pasen las verificaciones reales de Auth, Data API y autorización. Las pruebas locales no cubren la configuración alojada ni el comportamiento del proveedor.
