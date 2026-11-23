# IMP-02 · Categorías y gastos

Desde **Categorías** podés crear, renombrar, archivar y restaurar los dos niveles del catálogo. Un padre archivado deja de ofrecerse para gastos nuevos junto con sus hijas. Al restaurarlo se recuperan las hijas que estaban activas. Los registros históricos conservan su clasificación.

**Nuevo gasto** acepta UYU, USD y EUR, importe con coma o punto, fecha civil, categoría y los campos opcionales de subcategoría y descripción. El diálogo de creación selecciona la nueva clasificación y conserva el resto del borrador. La confirmación de guardado ofrece **Ver gasto** para editarlo o eliminarlo. Historial recuerda el último gasto consultado o guardado en la sesión. Su ficha individual admite un enlace directo y muestra la clasificación archivada cuando corresponde.

Cada alta usa un UUID estable. PostgreSQL reserva la clave y guarda el gasto en una transacción, con una huella SHA-256 del contenido inicial. La clave permanece reservada tras eliminar el gasto. Ante pérdida de respuesta el formulario conserva los datos y consulta el estado antes de repetir la operación. La edición comprueba la versión y permite revisar un conflicto manteniendo el borrador.

## Migraciones y desarrollo alojado

La rama parte del PR #3 de IMP-01, abierto en el momento de la entrega. El historial de desarrollo y los archivos de Git coinciden en versión y contenido tras normalizar los saltos de línea.

| Versión | Aplicación en desarrollo |
| --- | --- |
| `20261123215123_security` | Existente, reconciliada por IMP-01. |
| `20261123222557_restrict_api_rpc_grants` | Existente, reconciliada por IMP-01. |
| [`20261123223627_catalog_and_expenses`](../../supabase/migrations/20261123223627_catalog_and_expenses.sql) | Nueva y aplicada en `ljbrukrakumuatjnwxwd`. Creó las cuatro tablas, siete RPC, políticas, índices y provisión inicial. |

En PostgreSQL 17.12 alojado se verificaron **13 padres y 9 hijas** con los nombres y relaciones de RF-010 para la primera plaza. La segunda sigue libre. Las cuatro tablas tienen RLS por propietario con comprobación de sesión exacta. Los siete RPC son invocadores con `search_path` vacío y permiso de ejecución para `authenticated`. La auditoría comprobó además los permisos por columna, las funciones auxiliares y la denegación de acceso por la Data API al esquema `app`.

## Pruebas ejecutadas

| Prueba | Resultado y alcance |
| --- | --- |
| Unitarias · `npm test` | 53 aprobadas. Incluyen céntimos y límite superior exactos, años bisiestos, clasificación archivada, normalización, UUID y cambios del borrador. |
| SQL · `npm run test:db` | 13 aprobadas contando los dos grupos del runner. Se aplicaron todas las migraciones a PostgreSQL embebido, con una plaza previa y otra posterior a la provisión. Se comprobaron relaciones, permisos, aislamiento, validaciones, huella, reenvío tras editar y borrado. |
| Concurrencia · PostgreSQL 17.12 | Tres escenarios aprobados entre conexiones TCP independientes. La segunda conexión esperó por la clave y tras el commit obtuvo el gasto o el conflicto de huella. Tras el rollback pudo crearlo. En una prueba adicional se verificaron ambos órdenes de archivo de categoría y alta de gasto. |
| Chromium · `npm run test:e2e` | 20 aprobadas. Cubren acceso privado, catálogo, gastos en distintas monedas, diálogo secundario, ficha histórica archivada, doble envío, edición, eliminación, conflicto de versión y desconexión antes y después del commit. El navegador ejecutó la aplicación compilada. El transporte de pruebas simuló Auth y la Data API y ejecutó los RPC de negocio contra PostgreSQL embebido con datos sintéticos. |
| HTTP contra Supabase de desarrollo | Pasaron las dos pruebas públicas específicas de IMP-02. Los siete RPC rechazaron llamadas anónimas y las cuatro tablas privadas quedaron fuera de PostgREST. La prueba HTTP autenticada requiere una sesión Google autorizada. |
| Calidad y presentación | ESLint y build de Vite aprobados. Capturas de 1440 × 960, 834 × 1112 y 375 × 812 px. El control de fecha nativo usa la configuración regional del navegador. |

Para reproducir la concurrencia, instalá PostgreSQL 17 con ICU y ejecutá `node --test supabase/tests/database/concurrency.native.js`. El comando encuentra `initdb`, `pg_ctl` y `psql` en el PATH o en el directorio indicado por `CIFRA_PG_BIN`. Crea y cierra su propia instancia local. Para la suite web usá Chromium de Playwright o definí `CIFRA_CHROMIUM_PATH` según la [guía de IMP-01](../imp-01.md).

Para ejecutar la verificación HTTP, definí `CIFRA_RUN_HOSTED_TESTS=1` y ejecutá `node --env-file=.env.local --test tests/integration/catalog-expenses.test.js` con la URL y la clave publicable de desarrollo. Con `CIFRA_TEST_ACCESS_TOKEN_A` en el entorno también se ejecuta la lectura autenticada del catálogo. Los ensayos de borrado y concurrencia se hicieron sobre datos sintéticos aislados.

## Capturas de Chromium

| Pantalla | Escritorio · 1440 px | Tablet · 834 px | Móvil · 375 px |
| --- | --- | --- | --- |
| Nuevo gasto | [Escritorio](capturas/nuevo-1440.png) | [Tablet](capturas/nuevo-834.png) | [Móvil](capturas/nuevo-375.png) |
| Categorías | [Escritorio](capturas/categorias-1440.png) | [Tablet](capturas/categorias-834.png) | [Móvil](capturas/categorias-375.png) |
| Crear subcategoría | [Escritorio](capturas/dialogo-1440.png) | [Tablet](capturas/dialogo-834.png) | [Móvil](capturas/dialogo-375.png) |
| Editar gasto | [Escritorio](capturas/editar-1440.png) | [Tablet](capturas/editar-834.png) | [Móvil](capturas/editar-375.png) |
| Confirmar eliminación | [Escritorio](capturas/eliminar-1440.png) | [Tablet](capturas/eliminar-834.png) | [Móvil](capturas/eliminar-375.png) |

## Verificaciones pendientes

Queda pendiente el recorrido autenticado por la Data API alojada con una sesión Google de prueba. La comprobación móvil se ejecutó en Chromium con viewport de 375 px. La entrega mantiene el alcance de IMP-02 y la segunda plaza disponible para su habilitación manual posterior.

Los asesores de Supabase registran el bloqueo deliberado de la tabla privada de plazas, la configuración de protección de contraseñas del proyecto y cuatro índices nuevos todavía sin uso registrado. [Tabla protegida mediante RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) · [Protección de contraseñas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) · [Índices sin uso](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)
