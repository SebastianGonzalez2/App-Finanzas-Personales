# Keep alive y monitoreo de la base de producción

Un workflow de GitHub Actions consulta cada 8 horas la base de producción. Sirve para dos cosas: enterarse si la Data API o PostgreSQL dejan de responder y **reducir el riesgo** de que Supabase pause el proyecto por inactividad en el plan Free. **No garantiza que el proyecto no se pause**; la única forma documentada de evitarlo por completo es el plan Pro.

## Cómo funciona

```
GitHub Actions (cron o manual)
  → scripts/supabase-health-check.mjs
    → GET <SUPABASE_URL>/rest/v1/rpc/health_check   (clave publicable, esquema api)
      → PostgreSQL ejecuta api.health_check() en una transacción de solo lectura
        → {"status": "ok", "checked_at": "<hora de PostgreSQL>"}
```

| Pieza | Archivo |
| --- | --- |
| Función SQL | [`supabase/migrations/20261127190000_health_check.sql`](../supabase/migrations/20261127190000_health_check.sql) |
| Comprobación | [`scripts/supabase-health-check.mjs`](../scripts/supabase-health-check.mjs) |
| Programación | [`.github/workflows/supabase-keep-alive.yml`](../.github/workflows/supabase-keep-alive.yml) |
| Pruebas | [`tests/unit/health-check.test.js`](../tests/unit/health-check.test.js) y [`supabase/tests/database/health-check.test.js`](../supabase/tests/database/health-check.test.js) |

- **Horario:** `17 3,11,19 * * *` (UTC), es decir 00:17, 08:17 y 16:17 de Montevideo. GitHub puede demorar las ejecuciones.
- **Tiempo límite y reintentos:** 20 s por intento, hasta 3 intentos (esperas de 10 s y 30 s) ante errores de red, tiempo agotado o HTTP 408, 429, 500, 502, 503, 504 y 520–524. El job se corta a los 5 minutos.
- **Falla** si no hay respuesta, si el estado no es 200 o si el cuerpo no es el esperado. Los errores de configuración, permisos o proyecto pausado fallan sin reintentar.

## Seguridad

- La función es `SECURITY INVOKER`, tiene `search_path` vacío, no recibe argumentos y no lee ni escribe ninguna tabla.
- **Cambio de permisos:** el rol `anon` (visitante sin sesión) recibe `USAGE` sobre el esquema `api` y `EXECUTE` solo sobre `api.health_check()`. Antes no tenía acceso al esquema. No cambian las políticas RLS, Auth ni los permisos de `authenticated`.
- La migración se cancela entera si ese `USAGE` dejara a `anon` alcanzar cualquier otra función, tabla o vista de `api`. Toda función nueva de `api` debe seguir revocando permisos de forma explícita.
- Cualquiera que tenga la clave publicable (viaja en el JavaScript de la aplicación) puede llamar a la función. Solo obtiene el estado y la hora.
- No se usa `service_role` ni ninguna clave secreta. El script rechaza cualquier clave que no empiece con `sb_publishable_`.
- El repositorio es público, así que los registros de Actions también: muestran el host del proyecto, tiempos y códigos de error, nunca la clave ni el cuerpo de los errores.

## Configuración

En GitHub → **Settings → Secrets and variables → Actions**:

| Tipo | Nombre | Valor |
| --- | --- | --- |
| Variable | `CIFRA_PROD_SUPABASE_URL` | URL del proyecto de producción |
| Secret | `CIFRA_PROD_SUPABASE_PUBLISHABLE_KEY` | Clave publicable de producción (`sb_publishable_…`) |

Si se rota la clave publicable:

```sh
gh secret set CIFRA_PROD_SUPABASE_PUBLISHABLE_KEY
```

## Puesta en marcha

1. En el proyecto de **producción**, abrir el SQL Editor y ejecutar completo el contenido de la migración `20261127190000_health_check.sql`. Es repetible. Si más adelante se usa `supabase db push`, puede volver a ejecutarla sin problema, o se la puede marcar antes con `supabase migration repair 20261127190000 --status applied`.
2. Integrar el pull request en `main`. Las ejecuciones programadas solo corren desde la rama predeterminada.
3. Lanzar una ejecución manual (ver abajo) y confirmar que termina en verde.

## Comprobar el estado

En la pestaña **Actions → Supabase keep alive**, o desde la terminal:

```sh
gh workflow run supabase-keep-alive.yml
gh run list --workflow supabase-keep-alive.yml --limit 10
gh run view <ID> --log
```

Probarlo desde un equipo local, con las dos variables de entorno definidas (`SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`):

```sh
node scripts/supabase-health-check.mjs
```

GitHub avisa de las ejecuciones programadas fallidas a quien modificó por última vez la línea `cron`, según sus [preferencias de notificación](https://github.com/settings/notifications) (activar las de Actions).

| Resultado | Causa probable | Qué hacer |
| --- | --- | --- |
| `HTTP 540` | Proyecto pausado | Restaurarlo desde el panel de Supabase |
| Error de red o tiempo agotado en los 3 intentos | Incidente, proyecto pausado o URL incorrecta | Revisar el panel y [status.supabase.com](https://status.supabase.com) |
| `HTTP 404 PGRST202` | La migración no está aplicada | Paso 1 de la puesta en marcha |
| `HTTP 401` | Clave incorrecta o rotada, o permisos de la función cambiados | Actualizar el secret o reaplicar la migración |
| `HTTP 406` | `api` dejó de estar expuesto en la Data API | Revisar los ajustes de la Data API |

## Limitaciones

- **Sin garantía contra la pausa.** Supabase indica que pausa proyectos Free con poca actividad en 7 días y que, por lo general, [unas pocas solicitudes de usuarios a la base cada día](https://supabase.com/docs/guides/platform/free-project-pausing) alcanzan para evitarlo. También cita las llamadas a la API como forma de generar actividad. No publica un umbral, no se pronuncia sobre llamadas automáticas y puede cambiar el criterio. Estas son 3 consultas reales por día.
- La documentación no aclara si las tareas internas, como el `pg_cron` de los pagos recurrentes, cuentan como actividad.
- Supabase envía un correo al titular alrededor de una semana antes de pausar. **No ignorarlo**, aunque el workflow esté en verde. Un proyecto pausado se puede restaurar desde el panel durante un año.
- **Regla de los 60 días de GitHub:** en repositorios públicos, los workflows programados [se desactivan tras 60 días sin actividad en el repositorio](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). No hay que dar por hecho que las ejecuciones del propio workflow cuenten como actividad, y mientras está desactivado no hay alertas. Para reactivarlo: `gh workflow enable supabase-keep-alive.yml`, o el botón de la pestaña Actions. No se automatizó con commits artificiales ni dando permisos de escritura al workflow.
- GitHub puede demorar u omitir ejecuciones programadas cuando hay mucha carga. Con tres por día, perder una no es relevante.
- Solo comprueba Data API y PostgreSQL. No cubre Auth, el acceso con Google, el frontend en Vercel ni la integridad de los datos.

## Cuotas gratuitas

- **GitHub Actions:** los runners estándar [son gratuitos en repositorios públicos](https://docs.github.com/en/billing/concepts/product-billing/github-actions). Si el repositorio pasara a privado, serían unas 93 ejecuciones al mes de menos de un minuto (se factura un minuto cada una), muy por debajo de la cuota incluida en GitHub Free.
- **Supabase Free:** las [solicitudes a la API son ilimitadas](https://supabase.com/pricing) y la transferencia de unas 93 respuestas pequeñas al mes es insignificante frente a los 5 GB incluidos. La función no ocupa almacenamiento relevante.

## Desactivar

Pausar las ejecuciones (reversible):

```sh
gh workflow disable supabase-keep-alive.yml
```

Quitarlo por completo: borrar los archivos de la tabla anterior, revertir las dos excepciones en `permissions.test.js` y `catalog-expenses.test.js` y la nota de `hosted-security-audit.sql`, eliminar la variable y el secret, y versionar una migración nueva con:

```sql
begin;
drop function if exists api.health_check();
revoke usage on schema api from anon;
notify pgrst, 'reload schema';
commit;
```
