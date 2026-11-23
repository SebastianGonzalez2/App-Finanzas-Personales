# IMP-03 · Historial y consulta de gastos

**Historial** (`/historial`) lista los gastos de la persona con fecha, importe y código de moneda, categoría, subcategoría y descripción. Si falta la descripción, la fila se titula con la subcategoría o, en su defecto, con la categoría. Las clasificaciones archivadas conservan su nombre vigente y se marcan «Archivada». Las monedas nunca se convierten ni se suman. Cubre RF-014, RF-015 y RF-016 e integra la edición y la eliminación de IMP-02 (RF-007 y RF-008).

## Funcionalidad

| Área | Comportamiento |
| --- | --- |
| Búsqueda | Por descripción, insensible a mayúsculas y literal: `%`, `_` y `\` no actúan como comodines. El texto se publica en la URL tras una pausa breve o al pulsar Enter. Máximo 100 caracteres. |
| Período | Todo el historial, mes actual, mes anterior, últimos 3/6/12 meses, año actual o rango personalizado. Se calculan con la fecha civil del servidor (`today`). |
| Filtros | Desde, hasta, moneda, categoría y subcategoría, incluida «Sin subcategoría». Se combinan con AND. Las categorías y subcategorías archivadas siguen disponibles. Cambiar la categoría limpia una subcategoría incompatible. «Limpiar» restablece la consulta. |
| URL | `q`, `desde`, `hasta`, `moneda`, `categoria`, `subcategoria` (`ninguna` = sin hija), `orden=importe` y `sentido=asc`. Los valores por defecto se omiten. Un enlace con valores mal formados los descarta. Un ID inexistente o ajeno muestra «No pudimos aplicar esta consulta» y «Limpiar filtros». |
| Orden | Fecha o importe, ascendente o descendente. En escritorio, las columnas Fecha e Importe invierten el sentido y exponen `aria-sort`. En todos los anchos, el selector «Fecha ↓» ofrece las cuatro combinaciones. El orden por importe es nominal y cada fila muestra su moneda. |
| Paginación | 30 gastos por página con cursor. «Cargar más gastos» agrega la página siguiente sin descartar las anteriores. Si falla, aparece «Reintentar» y las filas cargadas se conservan. |
| Filas | Cada fila abre la ficha (`/historial?…&gasto=<id>`), que conserva la consulta para «Volver al historial». En escritorio y tablet, el menú de tres puntos ofrece Editar y Eliminar. En móvil, la fila compacta muestra fecha y clasificación bajo el título, y la ficha ofrece ambas acciones. |
| Estados | Esqueleto «Cargando gastos…». «Todavía no registraste gastos» con «Registrar el primer gasto». «Sin resultados» con «Limpiar filtros». Error de consulta con «Reintentar». Error de página siguiente. Atenuación «Actualizando» mientras llega la nueva consulta, sin bloquear la barra de filtros. Avisos «Cambios guardados» y «Gasto eliminado». |

### Integración con IMP-02

- Editar desde la fila o la ficha usa el formulario existente. Al guardar o eliminar se vuelve al Historial con la misma consulta (`state.from` admite ahora `/historial?…`). La posición de scroll se recupera por consulta exacta mediante `ScrollRestoration`.
- La eliminación desde el Historial reutiliza `delete_expense` y la reconciliación de IMP-02. `reconcileWrite` y `isUncertain` se trasladaron sin cambios de lógica de `ExpensePage.jsx` a [`reconcile.js`](../../src/features/expenses/reconcile.js), que ahora usan el formulario y el diálogo del Historial. Una respuesta perdida se comprueba con `get_expense` antes de repetir el envío.
- Las mutaciones invalidan las claves `[uuid, 'expenses', consulta]`. Al volver a la lista, TanStack Query la vuelve a leer desde la primera página y reconstruye los cursores. Un gasto que cambia de fecha o de clasificación se reubica o sale del filtro, y uno eliminado desaparece.
- La ficha `/historial?gasto=<id>` se trasladó a [`features/history/ExpenseDetail.jsx`](../../src/features/history/ExpenseDetail.jsx). Sin `gasto`, `/historial` muestra la lista en lugar de redirigir al último gasto consultado, que era el comportamiento provisional de IMP-02.

## Contrato y migración

[`20261124120000_expense_history.sql`](../../supabase/migrations/20261124120000_expense_history.sql) añade:

| Objeto | Detalle |
| --- | --- |
| `api.list_expenses(filters jsonb, q text, sort text, direction text, "limit" integer, cursor text) → {items, next_cursor}` | Contrato de ARCH-01 §8. `SECURITY INVOKER`, `STABLE`, `search_path` vacío. Ejecutable solo por `authenticated`. Comprueba plaza y sesión exacta con `private.require_access()` antes de validar argumentos. |
| Validación | Claves de filtro desconocidas, fechas inexistentes, tipos JSON incorrectos y `from > to` → 422. Hija sin padre, hija de otro padre o `unclassified_child` con hija → 422. Categoría o subcategoría inexistente o ajena → 404, sin revelar el dueño. `sort` y `direction` fuera de las cuatro combinaciones → 422. `limit` fuera de 1–100 → 422. |
| Orden y cursor | Cuatro sentencias estáticas, una por combinación, con `(clave, id)` como desempate en la misma dirección. Se leen `limit + 1` filas y el cursor se construye desde la última fila entregada solo si hay otra página. El cursor es base64url de JSON `{v, s, d, k, i, h}`. `h` es SHA-256 del dueño, los filtros normalizados, la búsqueda, el orden y el sentido. Un cursor alterado, de otro orden, de otros filtros o de otra persona → 422 `INVALID_CURSOR`. La consulta siempre filtra `owner_id = auth.uid()` además de RLS, así que el cursor nunca concede acceso. |
| Búsqueda | `ILIKE` con `\`, `%` y `_` escapados y `ESCAPE '\'`. Sin SQL dinámico ni interpolación de texto del usuario. |
| Respuesta | El mismo documento `Expense` que `get_expense`, con nombres vigentes y archivados resueltos en un único JOIN por página. |
| Índice | `expenses_amount_idx (owner_id, amount, id)` para el orden por importe. El orden por fecha usa `expenses_spent_on_idx (owner_id, spent_on, id)` en ambos sentidos. |
| Funciones auxiliares | `private.filter_date`, `private.filter_uuid`, `private.decode_cursor` y `private.encode_cursor`. Son invocadoras, con `search_path` vacío y `EXECUTE` solo para `authenticated`. |

### Estado en Supabase de desarrollo (`ljbrukrakumuatjnwxwd`)

**Aplicada el 23/11/2026** desde el editor SQL del panel, sin CLI ni conector disponibles.

1. **Historial previo.** `supabase_migrations.schema_migrations` contenía exactamente `20261123215123 security`, `20261123222557 restrict_api_rpc_grants` y `20261123223627 catalog_and_expenses`. El SQL almacenado coincide con los archivos del repositorio tras normalizar los saltos de línea. Solo `restrict_api_rpc_grants` difiere, por una línea en blanco final. `list_expenses` y `expenses_amount_idx` no existían. PostgreSQL 17.12.
2. **Entorno desechable.** Antes, todas las migraciones se aplicaron desde cero en PostgreSQL embebido. Así se ejecutó `npm run test:db`.
3. **Aplicación.** El contenido del archivo se ejecutó en una sola transacción, junto con su registro en `schema_migrations` como `20261124120000 expense_history`. Antes de ejecutarlo se comprobó el SHA-256 del texto cargado en el editor. Respuesta: «Success».
4. **Auditoría posterior.**
   - El historial tiene cuatro versiones y el MD5 almacenado coincide con el del archivo.
   - Las cinco funciones nuevas son `SECURITY INVOKER`, tienen `search_path` vacío y propietario `postgres`, y solo `authenticated` las ejecuta.
   - `anon` no ejecuta ningún RPC de `api`, que ahora tiene 10.
   - El índice `(owner_id, amount, id)` existe.
   - No se tocaron datos. La tabla de gastos de desarrollo tiene 0 filas.
5. **HTTP con la clave publicable.** `list_expenses` anónimo responde `42501` y aprueban las dos pruebas públicas de IMP-02.

Siguen pendientes:

- Las pruebas HTTP autenticadas. Con `CIFRA_TEST_ACCESS_TOKEN_A` se ejecuta la paginación y el rechazo de cursores alterados, y con `CIFRA_TEST_ACCESS_TOKEN_B`, el rechazo del cursor ajeno.
- `EXPLAIN (ANALYZE, BUFFERS)` con datos representativos. La tabla alojada está vacía, así que un plan medido ahí no sería representativo. Los planes por índice se verificaron en PostgreSQL embebido.

## Pruebas ejecutadas

| Prueba | Resultado y alcance |
| --- | --- |
| Unitarias · `npm test` | 69 aprobadas, 16 nuevas. Cubren la URL de ida y vuelta, el descarte de valores inválidos, «Sin subcategoría», los períodos con cambio de año y febrero bisiesto, los títulos, las fechas abreviadas y el título de fila sin descripción. |
| SQL · `npm run test:db` | 25 aprobadas, 12 nuevas contando el grupo del runner, sobre todas las migraciones en PostgreSQL embebido. Cubren el historial vacío, las tres monedas, la búsqueda literal con `%`, `_`, `\` y mayúsculas, los filtros combinados e inclusivos, la clasificación archivada y la validación de filtros, orden y límite. Las cuatro combinaciones de orden se comprueban con empates de fecha e importe. 246 gastos se recorren en páginas de 7 sin repetidos ni omisiones. Se rechazan 14 cursores alterados y los cursores de otro orden, filtros o persona. Se verifican los cambios entre páginas, el aislamiento A/B, el tercero sin plaza, la sesión cerrada, `anon` sin ejecución y los planes con los índices del propietario. La auditoría de superficie de IMP-02 se amplió con el RPC y las funciones nuevas. |
| Chromium · `npm run test:e2e` | 30 aprobadas, 10 nuevas, y las 20 previas sin cambios de comportamiento. Las nuevas cubren el alta desde el historial vacío y la búsqueda literal. Los filtros combinados persisten en la URL y tras recargar. También cubren la categoría y la subcategoría archivadas, «Sin resultados», «Limpiar filtros» y un enlace con categoría ajena. El orden se prueba en escritorio y con el selector. La paginación incluye 65 gastos y una desconexión en la segunda página con reintento. Editar fecha, importe y categoría desde el menú reubica la fila y la retira del filtro de la categoría anterior. La eliminación cubre la cancelación y una respuesta perdida reconciliada. En 375 px se abre la ficha y se elimina. Las filas ajenas permanecen invisibles. El transporte simula Auth y la Data API y ejecuta los RPC contra PostgreSQL embebido. |
| HTTP contra desarrollo | 3 aprobadas tras aplicar la migración: las 2 públicas de IMP-02 y la denegación anónima de `list_expenses` (`42501`). Antes de aplicarla respondía 404. Las autenticadas requieren una sesión Google. |
| Calidad | ESLint y build de Vite aprobados. Sin dependencias nuevas. |

## Capturas de Chromium

| Pantalla | Escritorio · 1440 px | Tablet · 834 px | Móvil · 375 px |
| --- | --- | --- | --- |
| Lista filtrada por mes | [Escritorio](capturas/lista-1440.png) | [Tablet](capturas/lista-834.png) | [Móvil](capturas/lista-375.png) |
| Panel de filtros | [Escritorio](capturas/filtros-1440.png) | [Tablet](capturas/filtros-834.png) | [Móvil](capturas/filtros-375.png) |
| Acciones de fila | [Escritorio](capturas/acciones-1440.png) | [Tablet](capturas/acciones-834.png) | En la ficha |
| Ficha del gasto | [Escritorio](capturas/detalle-1440.png) | [Tablet](capturas/detalle-834.png) | [Móvil](capturas/detalle-375.png) |
| Sin resultados | [Escritorio](capturas/sin-resultados-1440.png) | [Tablet](capturas/sin-resultados-834.png) | [Móvil](capturas/sin-resultados-375.png) |
| Historial vacío | [Escritorio](capturas/vacio-1440.png) | [Tablet](capturas/vacio-834.png) | [Móvil](capturas/vacio-375.png) |

## Pendientes

- Ejecutar las pruebas HTTP autenticadas y `EXPLAIN (ANALYZE, BUFFERS)` con datos de prueba representativos en `cifra-development`.
- Hacer el recorrido real Google → Crear gasto → Historial → Editar → Eliminar con datos de prueba, que quedó pendiente de IMP-02. Requiere que una persona inicie sesión con la cuenta Google autorizada en `http://localhost:5173`. Para la prueba HTTP autenticada, el JWT se copia desde una sesión dedicada siguiendo la [guía de IMP-01](../imp-01.md).
- Comprobar en un teléfono físico la apertura de la ficha y el selector nativo de período y orden. El control de fecha nativo muestra el formato regional del navegador.
