# IMP-06 · Auditoría integral, seguridad, rendimiento y preparación para producción

Última etapa de implementación de la V1. No agrega funcionalidades, no cambia la arquitectura aprobada ([ARCH-01](../arquitectura-v1.md)) ni el diseño de [UI-01](../design/ui-01/README.md). Se auditó la aplicación de forma independiente de las pruebas previas, se corrigieron los defectos reproducibles y se preparó el lanzamiento en Vercel sin tocar producción.

**Veredicto: NO-GO condicionado** para publicar hoy. No quedan defectos abiertos: el único P1 (D-01) se corrigió en la configuración de desarrollo con autorización del titular. Faltan condiciones operativas que requieren al titular (§10): aislamiento con las dos plazas reales, teléfono físico y la creación y verificación de Supabase y Vercel de producción. Cuando se cumplan, el veredicto pasa a **GO**.

## 1. Estado inicial

Rama `claude/IMP-06` creada desde `main` (`dc1b34a`, PR #7 fusionado). Línea base del 24/11/2026:

| Prueba | Resultado inicial |
| --- | --- |
| ESLint | Aprobado |
| Unitarias (Vitest) | 88/88 |
| SQL (PostgreSQL 17 embebido, PGlite) | 55/55 |
| E2E Chromium (Playwright) | 60/60 (tras instalar el Chromium de Playwright 1.65; el instalado era de una versión anterior) |
| HTTP públicas contra `cifra-development` | 7/7; 9 omitidas por falta de sesiones (JWT) |
| `npm audit` | 0 vulnerabilidades |
| Supabase de desarrollo | 6 migraciones aplicadas, una plaza habilitada, cuenta sin gastos |

Pendientes heredados de IMP-01 a IMP-05: pruebas HTTP autenticadas, aislamiento entre las dos plazas reales, verificación alojada con volumen, teléfono físico y preparación de producción.

## 2. Alcance y método

- **Funcional:** recorridos completos de usuario (no pantallas aisladas) en el build de producción contra las migraciones reales, y un recorrido real con Google en Supabase de desarrollo.
- **Exactitud:** modelo propio en centésimos `BigInt`, escrito para esta auditoría (no reutiliza `oracle.js`), comparado contra todas las vistas tras ediciones y eliminaciones aleatorias reproducibles.
- **Seguridad:** HTTP autenticado con la sesión real ejecutado dentro del navegador (el JWT nunca se copió a archivos, variables ni salidas), metadatos del proyecto alojado con una consulta de solo lectura, secretos en repositorio, historial y bundle, y dependencias.
- **Rendimiento:** medición en celular emulado, volumen en SQL y latencia real a Supabase; antes y después de cada cambio.
- **Visual y responsive:** Playwright en **Chromium y WebKit** a 360, 375, 390, 430, 768, 1024 y 1440 px. **Todo es emulación de viewport; no se usó un teléfono físico.**
- **Producción:** configuración de Vercel, variables, OAuth, migraciones, rutas directas, despliegue y recuperación.

## 3. Defectos encontrados

| ID | Gravedad | Área | Defecto | Estado |
| --- | --- | --- | --- | --- |
| D-01 | **P1** | Seguridad · configuración alojada | En `cifra-development` el proveedor **Email** de Supabase Auth estaba habilitado (`external.email = true`, `mailer_autoconfirm = true`). Con las altas cerradas no se crean cuentas, pero una cuenta existente podría entrar por enlace mágico o recuperación por correo sin pasar por Google. Contradice RF-001, D-05 e [IMP-01](../imp-01.md) §1. No se envió ningún correo para explotarlo. | **Corregido** el 24/11/2026 con autorización del titular: Authentication → Sign In / Providers → Email → «Enable email provider» desactivado. `/auth/v1/settings` expone solo `google`. Regresión: `private-access.test.js` exige proveedor único (falló antes del cambio, pasa después). |
| D-02 | P2 | Sesión | Cada renovación del token de la misma persona (≈ cada hora, o al volver a la pestaña) reemplazaba toda la aplicación por «Verificando tu sesión…», vaciaba la caché y volvía a montar la pantalla: se perdían el foco del formulario, el scroll y las páginas ya cargadas del Historial, y se repetían todas las lecturas. | Corregido. 3 pruebas E2E con reloj controlado. |
| D-03 | P2 | Accesibilidad móvil | Áreas táctiles por debajo de los 44 × 44 px que exige UI-01 en celular: menú «⋯» de cada límite (36 px), orden del Historial (36 px), «Ver datos» (32 px), enlaces de panel del Resumen (19 px) e importes de Indicadores (31 px). Igual en Chromium y WebKit. | Corregido solo en el área de acierto (sin cambios visibles). Auditoría automática en 4 anchos y 2 motores. |
| D-04 | P2 | Presentación de importes | A 360 px, un total del mes desde **UYU 1.000.000,00** se partía en dos líneas a mitad del número en el Resumen (también desde 10.000.000 en Indicadores); un exceso de presupuesto muy grande salía del arco. | Corregido: los importes largos reducen su tamaño por longitud; el arco comprime el porcentaje. Regresión en Chromium y WebKit. |
| D-05 | P3 | Fechas | `today` (fecha civil del servidor) solo se renovaba al volver a enfocar la pestaña; ARCH-01 §9 pide refrescarla al cambiar el día si la app sigue abierta. Con la app abierta a medianoche, el Resumen podía mostrar el mes anterior mientras Presupuestos ya usaba el nuevo. | Corregido: se vuelve a pedir a la medianoche de Montevideo. Prueba unitaria de la frontera (03:00 UTC). |
| D-06 | P3 | Presentación | Las barras del Resumen rotulaban «1.000.000M» desde mil millones; Estadísticas usa «MM». | Corregido. Prueba unitaria. |
| D-07 | P3 | Producción | `vercel.json` no daba caché larga a los assets con hash (ARCH-01 §13) y un build en Vercel sin variables de Supabase, o de Producción apuntando a desarrollo, se publicaba igual. | Corregido. Pruebas unitarias de reescrituras, cabeceras y del bloqueo del build. |
| D-08 | P3 | Observación alojada | `graphql_public` conserva `USAGE` para `anon` en desarrollo (la migración lo revoca; la plataforma lo restableció). `pg_graphql` no está instalado y el endpoint responde cerrado. | Sin riesgo actual. Ítem del checklist de producción. |
| D-09 | P3 | Pruebas | La suite E2E reescribe las capturas versionadas de IMP-02 a IMP-05 en cada corrida y el doble de Auth usaba una redirección que WebKit no admite. | Fixture compatible con WebKit. Las capturas previas se restauran tras cada corrida; no se cambió ese comportamiento heredado. |

No se encontraron discrepancias financieras: el motor SQL de IMP-04/05 coincidió con el modelo independiente en todos los casos (§5). No hubo P0.

**Sin corregir por estar fuera de proporción:** con importes absurdos de 12 cifras (999.999.999.999,99) un nombre de categoría corto puede partirse en «Vivien/da» en la lista del Resumen a 768 px. Es una prueba de estrés; con importes reales no ocurre.

## 4. Correcciones realizadas

| Commit | Cambio |
| --- | --- |
| `f266688` | Áreas táctiles de 44 px en celular (`styles.css`, `history.css`, `stats.css`); `figureSize()` y `data-size` para importes largos en Resumen, Indicadores y Presupuestos; arco con `textLength` para porcentajes largos; rótulo «MM». Nueva auditoría responsive y proyecto WebKit en Playwright. |
| `effeafb` | `SessionProvider` vacía la caché solo al cambiar de persona o salir; `useAccess` verifica el token renovado con las preferencias ya confirmadas como `placeholderData` del mismo UUID (un rechazo sigue cerrando el acceso); `refetchInterval` hasta la medianoche de Montevideo (`untilNextCivilDay`). |
| `09e41ed` | `vercel.json`: `npm ci`, `dist`, `Cache-Control: public, max-age=31536000, immutable` solo para `/assets/*`, `Permissions-Policy`. `deploymentProblem()` hace fallar el build en Vercel sin Supabase válido o con Producción apuntando a `cifra-development`. |
| `0206b2e`, `6eb9162`, `ee08cfe` | Pruebas nuevas de auditoría (coherencia, zona horaria, formato exacto, teclado y foco, proveedor único) y consulta SQL de auditoría alojada. |

Ningún cambio toca migraciones, contratos RPC, políticas RLS ni el diseño visual aprobado.

## 5. Exactitud financiera

[`audit-coherence.test.js`](../../supabase/tests/database/audit-coherence.test.js) genera con semilla fija 600 gastos en UYU, USD y EUR entre 2019 y 2026 (importes de 0,01 a 999.999.999.999,99, con y sin subcategoría), archiva una categoría con gastos históricos y crea límites (uno de ellos bajo la categoría archivada). Luego aplica tres rondas de 60 mutaciones (importe, fecha a otro mes o año, moneda, categoría, quitar subcategoría, eliminar) y 20 altas. Antes y después de cada ronda, **para cada moneda**:

| Comparación | Resultado |
| --- | --- |
| `get_stats` del mes (Resumen y Estadísticas usan la misma llamada) = todas las páginas de `list_expenses` = modelo | Igual en cantidad y total al centésimo, 4 verificaciones × 3 monedas × 2 rangos |
| Categorías: total, cantidad y participación (redondeo único a 2 decimales) | Igual al modelo; ninguna duplicación (suma de meses = total) |
| Subcategorías de la categoría principal | Suman exactamente el padre |
| Serie anual de cinco años | Cada año = modelo del año civil; año en curso parcial; variación solo entre años cerrados con registros |
| Presupuestos | Consumo = total de la categoría en `get_stats` del mes; restante y porcentaje exactos, incluido un límite de 0,01 % y otro de 999.999.999.999,99 |
| Separación de monedas | Ninguna vista suma importes de otra moneda |
| Categoría archivada con gastos | Sigue contabilizada en todas las vistas |

Además: `today()` cambia exactamente a las 03:00 UTC (medianoche en Montevideo), incluidos fin de año y 29 de febrero de 2028; las sumas por encima de 2^53 centésimos se formatean sin pasar por `Number` y el estado del presupuesto se decide por centésimos exactos. Las pruebas previas siguen cubriendo 0,10 + 0,20, años bisiestos, rangos 0001/9999, empates, comparaciones no equivalentes y cambio de mes (IMP-04/05).

**En Supabase de desarrollo con la sesión real** (gastos «(borrar) IMP-06»): UYU 100 + 200 y USD 300 → UYU 300,00 en 2 gastos; 0,10 + 0,20 EUR = 0,30; Alimentación = suma de sus subcategorías; Resumen = Estadísticas = suma del Historial; límite 15.000 con 300 consumidos = 2,00 %; editar 200 → 100 y mover de mes restan exactamente 100 cada vez.

## 6. Seguridad y privacidad

### Proyecto alojado `cifra-development` (consulta de solo lectura [`hosted-security-audit.sql`](../../supabase/audit/hosted-security-audit.sql))

| Comprobación | Resultado |
| --- | --- |
| Migraciones | Las 6 versiones del repositorio, en orden |
| RLS | Activa en las 7 tablas de `app` y en las 2 de `private`. Todas las políticas de `app` exigen `owner_id = auth.uid()` **y** `private.allowed()`; roles: `authenticated` (y `supabase_auth_admin` solo para la lista de admisión) |
| Permisos de tabla | `anon` sin acceso a ninguna. `authenticated`: lo mínimo de ARCH-01 §7 (p. ej. `preferences` solo columnas; `expense_keys` sin UPDATE/DELETE; `members` y `bootstrap_emails` sin acceso). El cliente no lee `auth.sessions` |
| Funciones | 17 RPC en `api`, todas `SECURITY INVOKER`, ejecutables solo por `authenticated`. Única `SECURITY DEFINER`: `private.allowed()` (propietario `postgres`, `STABLE`, sin argumentos, sin `EXECUTE` para `anon` ni `service_role`). Todas con `search_path` vacío |
| Esquemas | `app` y `private` sin `USAGE` para `anon`; `public` sin tablas ni funciones; ver D-08 para `graphql_public` |
| Identidades | 1 usuario de Auth, 1 identidad (Google), 1 plaza con identidad Google, lista de admisión vacía |
| Auth público | Altas cerradas; anónimos deshabilitados; Google como único proveedor (Email desactivado al corregir D-01) |

### HTTP autenticado con la sesión real de la primera plaza (17/17 aprobadas)

Arnés [`hosted-session.audit.js`](../../tests/integration/hosted-session.audit.js), ejecutado en la página de `npm run dev` con la sesión de Google ya iniciada. Cubre: preferencias y moneda (con restauración), catálogo de 13 categorías, ejemplos RF-017/018/025, coherencia entre vistas, presupuesto completo (duplicado 409, subcategoría 404, exceso, retiro dos veces 404), edición con versión obsoleta 409, idempotencia (`replayed`, `ID_REUSED`, `EXPENSE_REMOVED` tras borrar), 8 validaciones 422, identificadores inexistentes 404 en 6 RPC, manipulación de parámetros (`owner_id` extra rechazado por PostgREST, cursor alterado 422, filtro desconocido 422, página de 1.000 rechazada), esquemas `app`, `private`, `auth` y `public` cerrados, GraphQL cerrado, JWT con firma alterada o ausente 401. Al final quedaron 0 gastos rotulados.

HTTP públicas: 7/7 (RPC sin sesión 401/42501, tablas fuera de PostgREST, altas cerradas y Google como único proveedor). La aserción de proveedor único falló antes de corregir D-01 y pasa después.

### Repositorio, bundle y dependencias

- Sin secretos en archivos versionados ni en el historial completo de Git (solo nombres de rol SQL y el valor ficticio `sb_secret_fixture` de una prueba). `.env.local` está ignorado. La referencia del proyecto de desarrollo aparece en documentación y pruebas: es pública (va en el bundle) y no da acceso.
- El bundle solo contiene la URL y la clave publicable. CSP del build: `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `connect-src` limitado a Supabase, `frame-ancestors 'none'` por cabecera. Sin errores de CSP en Chromium ni WebKit (los avisos de WebKit al capturar provienen de Playwright y desaparecen sin capturas).
- `npm audit`: 0 vulnerabilidades (producción y desarrollo).

### Pendiente con intervención del titular

| Caso | Estado |
| --- | --- |
| Aislamiento A/B con las dos plazas reales (lectura, edición y borrado cruzados, conteo de filas de B antes y después) | **BLOCKED**: la segunda plaza no está habilitada. Cubierto en PostgreSQL embebido (IMP-02 a IMP-05 y esta auditoría) |
| Identidad Google autenticada sin plaza → 403 | **BLOCKED**: requiere una tercera cuenta. Cubierto en PostgreSQL embebido y E2E |
| Cierre de sesión: el JWT anterior queda sin acceso | **PASS** con la sesión real (403 en lectura, escritura y agregados; §9) |
| Otra sesión de la misma persona sigue funcionando tras cerrar la primera | **BLOCKED**: requiere un segundo inicio de sesión con Google |
| JWT vencido naturalmente | **PASS** (401 `PGRST303` en lectura y escritura; §9) |

## 7. Rendimiento

### Celular emulado (Chromium, 375 px, CPU 4×, red móvil de Lighthouse: 150 ms RTT, 1,6 Mbps)

[`audit-performance.spec.js`](../../tests/e2e/audit-performance.spec.js), build de producción, 3.650 gastos de diez años, cinco cargas con caché vacía. La Data API corre en la misma máquina (sin red real).

| Métrica (mediana) | Valor |
| --- | --- |
| First Contentful Paint | 1,45 s |
| Largest Contentful Paint | 1,61 s |
| Total del mes visible | 1,74 s |
| Resumen completo | 1,75 s |
| Transferido | 207 KiB |

| Paso con caché caliente | Tiempo | RPC |
| --- | --- | --- |
| Resumen → Historial | 0,98 s | `list_expenses`, `get_catalog` |
| Historial · cargar más | 0,32 s | `list_expenses` |
| Historial → Presupuestos | 0,43 s | ninguna (caché del Resumen) |
| Presupuestos → Estadísticas | 1,48 s | `get_annual` (más el chunk de gráficos de 123 KB) |
| Estadísticas · Últimos 12 meses | 0,87 s | `get_stats` |
| Estadísticas → Resumen | 0,35 s | ninguna |
| Resumen → Nuevo gasto | 0,10 s | ninguna |

Sin RPC repetidas ni cascadas: cada pantalla pide solo lo que muestra y las lecturas compartidas salen de la caché.

### Bundle (gzip)

| Archivo | Antes (`main`) | Después |
| --- | --- | --- |
| JS inicial (`index`) | 144,26 KB | 144,69 KB |
| Supabase | 56,27 KB | 56,27 KB |
| Gráficos (diferido) | 123,34 KB | 123,34 KB |
| CSS | 8,59 KB | 8,73 KB |

**Decisión:** no dividir más el bundle. Con LCP de 1,6 s en la red móvil de referencia, separar rutas ahorraría a lo sumo unos 20 KB comprimidos (≈ 0,1 s) a costa de más estados de carga.

### SQL con volumen ([`audit-volume.test.js`](../../supabase/tests/database/audit-volume.test.js))

Dos personas con 36.500 gastos cada una (73.000 filas), PostgreSQL embebido de un hilo (cota pesimista), mediana de 7 ejecuciones:

| RPC | ms |
| --- | --- |
| `get_preferences` | 1,4 |
| `get_stats` mes / 12 meses / 10 años con categoría | 9,0 / 14,4 / 18,5 |
| `get_annual` (todas las categorías) | 11,1 |
| `get_budgets` | 3,1 |
| `list_expenses` por fecha / por importe | 4,0 / 2,8 |
| `list_expenses` con búsqueda / sin resultados | 19,2 / 23,9 |

Los períodos usan `expenses_currency_date_idx` bajo RLS y `private.allowed()` se evalúa una vez por sentencia (InitPlan). No se agregan índices (un trigram no se justifica con 24 ms).

### Latencia real a Supabase de desarrollo

Desde el equipo de desarrollo (red fija, no celular), 12 llamadas por RPC con la sesión real: medianas de 63 a 76 ms; p95 de 71 a 76 ms salvo la primera conexión (594 ms, TLS).

### Efecto de las correcciones

- **D-02:** antes, cada renovación del token desmontaba la vista y volvía a descargar todo; después, la renovación no desmonta la pantalla y el Historial ya cargado no se vuelve a pedir completo (la prueba admite como máximo dos lecturas).
- **D-07:** en Vercel, sin `Cache-Control` explícito cada visita revalida los assets; con `immutable` las visitas siguientes no los vuelven a pedir. Se medirá en el primer despliegue (checklist).

## 8. Auditoría visual y responsive

[`audit-responsive.spec.js`](../../tests/e2e/audit-responsive.spec.js) recorre Resumen, Estadísticas, Historial, ficha de gasto, Presupuestos y su diálogo, Categorías, Mi cuenta, Nuevo gasto, Editar gasto, diálogo de eliminación y menú de navegación, en **Chromium y WebKit**, a 360, 375, 390, 430, 768, 1024 y 1440 px (14 combinaciones): sin desbordamiento horizontal de página ni de diálogos, áreas táctiles ≥ 44 px en celular, sin errores de consola. También recorre con Tab seis pantallas a 375 y 1440 px exigiendo foco visible en cada parada, y comprueba importes largos a 360 px.

| Vista | Captura |
| --- | --- |
| Resumen · 360 · Chromium | [360-resumen](capturas/chromium-360-resumen.png) |
| Estadísticas · 360 · Chromium | [360-estadisticas](capturas/chromium-360-estadisticas.png) |
| Historial · 360 · Chromium | [360-historial](capturas/chromium-360-historial.png) |
| Presupuestos · 360 · Chromium | [360-presupuestos](capturas/chromium-360-presupuestos.png) |
| Nuevo gasto · 360 · Chromium | [360-nuevo-gasto](capturas/chromium-360-nuevo-gasto.png) |
| Menú · 360 · Chromium | [360-menu](capturas/chromium-360-menu.png) |
| Crear límite · 390 · Chromium | [390-presupuesto-dialogo](capturas/chromium-390-presupuesto-dialogo.png) |
| Ficha de gasto · 430 · Chromium | [430-detalle](capturas/chromium-430-detalle.png) |
| Resumen · 375 · WebKit | [375-resumen](capturas/webkit-375-resumen.png) |
| Estadísticas · 375 · WebKit | [375-estadisticas](capturas/webkit-375-estadisticas.png) |
| Historial · 390 · WebKit | [390-historial](capturas/webkit-390-historial.png) |
| Presupuestos · 430 · WebKit | [430-presupuestos](capturas/webkit-430-presupuestos.png) |
| Resumen · 768 · Chromium | [768-resumen](capturas/chromium-768-resumen.png) |
| Estadísticas · 1024 · Chromium | [1024-estadisticas](capturas/chromium-1024-estadisticas.png) |
| Resumen · 1440 · Chromium | [1440-resumen](capturas/chromium-1440-resumen.png) |
| Presupuestos · 1440 · WebKit | [1440-presupuestos](capturas/webkit-1440-presupuestos.png) |

Las capturas usan datos de estrés a propósito (un gasto de 999.999.999.999,99) para mostrar los peores anchos. WebKit en Windows es el motor de Safari, no Safari de iOS: no reproduce el teclado virtual, la barra de direcciones ni los selectores nativos de un iPhone.

## 9. Recorrido real con Google (Supabase de desarrollo)

24/11/2026, `npm run dev` en el navegador integrado, sesión vigente de la primera plaza (sin leer tokens):

1. Nuevo gasto UYU 1.234,50 · Alimentación / Supermercado · «(borrar) IMP-06 recorrido» → «Gasto guardado», visible en el Historial.
2. Crear límite Alimentación · UYU 15.000 → 8,23 %, restan 13.765,50.
3. Resumen 1.234,50 = Estadísticas 1.234,50 = consumo del límite = Historial.
4. Editar a 1.000 y al 15/10 → noviembre sin registros, límite 0 %, octubre 1.000,00 en Estadísticas y en el Resumen («Octubre completo»).
5. Favorito «Indicadores» y vista «Mis favoritos · 1»; USD sin cifras UYU; USD conservado en Resumen y Presupuestos tras recargar.
6. Serie anual 2022–2026 → 2017–2021 → 2022–2026, con el período de 12 meses intacto.
7. Limpieza desde la interfaz: quitar favorito, eliminar el gasto (confirmado), retirar el límite, volver a UYU. Consola sin errores.

Estado final de la cuenta: 0 gastos, 0 límites, 0 favoritos, moneda UYU. `app.expense_keys` conserva las reservas de los envíos (solo identificador y huella SHA-256, sin importe ni descripción), por diseño de RF-009.

**Sesiones (§6), con la sesión real de la primera plaza:** se retuvo en memoria de una pestaña el access token vigente (sin mostrarlo ni guardarlo). Antes del cierre: lectura y escritura 200. Tras «Mi cuenta → Cerrar sesión» en otra pestaña, ese mismo JWT —criptográficamente válido, a 31 minutos de vencer— recibió **403 ACCESS_DENIED** en `get_preferences`, `set_currency` y `get_stats` (la sesión exacta dejó de existir en `auth.sessions`). A las 18:03:42 UTC, 44 s después de su vencimiento natural, recibió **401 `PGRST303 JWT expired`** en lectura y escritura. Luego se borró de la memoria. Queda pendiente la parte de ARCH-01 §14.3 que exige **una segunda sesión de la misma persona** que siga funcionando tras cerrar la primera: necesita otro inicio de sesión con Google (§10).

## 10. Preparación para producción

### Estado verificado

- **Separación de entornos:** solo existe `cifra-development` (Supabase) y no hay proyecto de Vercel para Cifra (los dos proyectos `finanzas-personales-*` de la cuenta son de la app anterior). El build de Producción en Vercel se rechaza si apunta a `cifra-development`.
- **Variables:** solo `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` (públicas). El secreto de Google, la contraseña de la base y los tokens de administración viven en Supabase o en el gestor del titular.
- **Rutas directas:** todas las rutas de la SPA, incluida `/auth/callback`, se reescriben a `index.html`; `/assets/*`, `/cifra.svg` y `/index.html` no, así que un asset inexistente da 404 (prueba `deploy-config.test.js`).
- **Build:** `npm run build` sin advertencias; `dist` con nombres con hash.

### Checklist de lanzamiento

Cada paso de Supabase y Vercel lo ejecuta el titular o se ejecuta con su autorización explícita. **Nada de esto se hizo en IMP-06.**

**A. Bloqueantes previos**
- [x] D-01: proveedor Email deshabilitado en `cifra-development`; `npm run test:integration` confirma Google como único proveedor.
- [ ] Habilitar la segunda plaza en desarrollo y completar el aislamiento A/B real (`CIFRA_TEST_ACCESS_TOKEN_B` o el arnés en el navegador con cada perfil).
- [ ] Decidir plan de Supabase para producción: Free (pausa por inactividad, copias externas propias) o Pro (copias diarias, sin pausa). ARCH-01 §2.
- [ ] Verificar en un teléfono físico (Android y, si es posible, iPhone): OAuth, teclado decimal, selectores nativos de fecha y período, toque en gráficos.

**B. Supabase de producción (proyecto nuevo)**
- [ ] Crear el proyecto en la región elegida, distinto de `cifra-development`.
- [ ] Data API: exponer solo `api`; quitar `public` y `graphql_public` de los esquemas expuestos; GraphQL deshabilitado (D-08).
- [ ] Auth: solo Google; Email, teléfono, anónimos y vinculación manual deshabilitados; altas cerradas.
- [ ] Google Cloud: cliente OAuth web de producción; URI autorizada `https://<REF_PROD>.supabase.co/auth/v1/callback`; pantalla de consentimiento publicada para las dos cuentas.
- [ ] Supabase Auth: Site URL `https://<dominio>`; Redirect URLs exactamente `https://<dominio>/auth/callback` (sin comodines).
- [ ] Aplicar las 6 migraciones en orden con `supabase db push` tras `--dry-run` y una copia recuperable (base vacía).
- [ ] Ejecutar [`hosted-security-audit.sql`](../../supabase/audit/hosted-security-audit.sql) y comparar con §6 (RLS, permisos, `SECURITY DEFINER`, `search_path`).
- [ ] Habilitar el hook Before User Created; cargar los dos correos en `private.bootstrap_emails`; abrir altas; cada persona entra con Google; verificar UUID, proveedor e identidad; cerrar altas; asignar plazas con el SQL de IMP-01; vaciar la lista.

**C. Vercel**
- [ ] Crear el proyecto Cifra desde el repositorio (preset Vite; `vercel.json` fija `npm ci`, `npm run build` y `dist`; Node 24).
- [ ] Variables de **Production**: URL y clave publicable del proyecto de producción. Variables de **Preview**: las de `cifra-development` (o ninguna; el build falla sin ellas).
- [ ] Desplegar Preview y comprobar: recarga directa de `/historial`, `/estadisticas?periodo=6m` y `/auth/callback`; un asset inexistente da 404; cabeceras (`frame-ancestors`, `nosniff`, `no-referrer`, `Permissions-Policy`, `immutable` en `/assets`).
- [ ] Promover a Production solo con autorización del titular.

**D. Verificación posterior**
- [ ] Las dos personas entran con Google desde sesiones nuevas y ven solo sus datos.
- [ ] `npm run test:integration` con `CIFRA_TEST_SUPABASE_URL` de producción (pruebas públicas; sin datos de prueba en producción).
- [ ] Cerrar sesión y confirmar que el JWT anterior queda rechazado.
- [ ] Primera copia lógica externa cifrada (ARCH-01 §2).

### Despliegue y recuperación

- **Despliegue:** migraciones y SPA son operaciones separadas (ARCH-01 §13). Primero migraciones aditivas, después SPA.
- **Build fallido:** Vercel conserva el despliegue anterior; el bloqueo de variables (D-07) evita publicar una SPA sin Supabase.
- **SPA defectuosa ya publicada:** *Instant Rollback* de Vercel al despliegue anterior (los contratos RPC de la V1 no cambian, así que la versión anterior sigue siendo compatible).
- **Migración defectuosa:** nunca editar una migración aplicada; corregir con una migración posterior. Si hay pérdida de datos, restaurar la copia en un destino aislado según ARCH-01 §13 antes de reabrir el acceso.

## 11. Matriz de trazabilidad

PASS = ejecutado con evidencia. FAIL = ejecutado y no cumple. BLOCKED = no ejecutable sin intervención del titular. NOT RUN = no ejecutado. «Embebido» = migraciones reales en PostgreSQL 17 (PGlite); «E2E» = build de producción en navegador contra esas migraciones; «Alojado» = `cifra-development` con la sesión real.

| RF | Criterio | Evidencia | Estado |
| --- | --- | --- | --- |
| RF-001 | Solo Google; tercero sin acceso | Alojado: altas cerradas, 1 identidad Google, Google como único proveedor (tras corregir D-01). Tercero sin plaza: embebido + E2E | **PASS** · tercero real BLOCKED |
| RF-002 | Sesión válida continúa; ausente, inválida, vencida o cerrada sin datos | Alojado: sesión real, JWT alterado y ausente 401; renovación E2E (D-02). Ver §9 | **PASS** (alojado: cierre → 403 con JWT aún vigente; vencido → 401) · segunda sesión simultánea BLOCKED |
| RF-003 | A no accede a B; externo 403 | Embebido (4 suites) + E2E; alojado: IDs inexistentes 404, `owner_id` rechazado, esquemas cerrados | PASS embebido · **BLOCKED** con dos plazas reales |
| RF-004 | Crear gasto actualiza historial, estadísticas y presupuestos | Alojado (UI y HTTP), E2E, coherencia | PASS |
| RF-005 | Validación | Alojado 8 × 422; embebido; E2E | PASS |
| RF-006 | Fecha efectiva | Alojado (mover a octubre); coherencia; frontera de Montevideo | PASS |
| RF-007 | Editar sin duplicar, también entre meses | Alojado (UI y HTTP, versión obsoleta 409); coherencia (180 mutaciones) | PASS |
| RF-008 | Eliminar confirmado | Alojado (UI); E2E; coherencia | PASS |
| RF-009 | Sin duplicados ni falso éxito | Alojado (`replayed`, `ID_REUSED`, `EXPENSE_REMOVED`); E2E de red interrumpida; concurrencia nativa (IMP-02) | PASS |
| RF-010 | 13 categorías iniciales | Alojado (13 + 9); embebido | PASS |
| RF-011 | Crear categoría desde el formulario | E2E y embebido. No se repitió en alojado para no dejar categorías (no se pueden eliminar) | PASS (E2E) |
| RF-012 | Renombrar, archivar, restaurar | Embebido + E2E; coherencia con categoría archivada | PASS |
| RF-013 | Jerarquía sin duplicar | Embebido; alojado (hijas = padre; límite en subcategoría 404) | PASS |
| RF-014 | Listado | Alojado (UI); E2E | PASS |
| RF-015 | Búsqueda y filtros | E2E; alojado (búsqueda por rótulo y filtros); volumen | PASS |
| RF-016 | Orden y páginas | Embebido; E2E; coherencia (orden por importe, páginas de 100); alojado (cursor alterado 422) | PASS |
| RF-017 | Indicadores por moneda | Alojado (100 + 200 UYU, 300 USD); coherencia | PASS |
| RF-018 | Categorías y subcategorías | Alojado; coherencia (participaciones, hijas) | PASS |
| RF-019 | Evolución mensual | Coherencia (suma de meses); E2E; alojado (UI) | PASS |
| RF-020 | Serie anual y bloques de años | Coherencia; alojado (2017–2021 y vuelta con el período intacto) | PASS |
| RF-021 | Moneda compartida, filtros y favoritos | Alojado (USD en las tres pantallas tras recargar, favorito); E2E con respuesta tardía | PASS |
| RF-022 | Desglose al Historial | E2E; alojado (enlaces con filtros) | PASS |
| RF-023 | Consistencia y resumen descriptivo | Coherencia; alojado (editar −100); E2E | PASS |
| RF-024 | Crear presupuesto | Alojado (UI y HTTP); embebido | PASS |
| RF-025 | Seguimiento, exceso y cambio de mes | Alojado; coherencia; embebido (cambio de mes y año) | PASS |
| RF-026 | Modificar y retirar | Alojado (UI y HTTP); embebido | PASS |
| RF-027 | Resumen coincide con Estadísticas | Alojado (1.234,50 en ambas); coherencia; E2E | PASS |
| Calidad | Privacidad · exactitud · integridad · experiencia · rendimiento · conectividad | §5 a §8; red interrumpida (E2E IMP-02/03) | PASS · teléfono físico NOT RUN |

## 12. Resultados de las pruebas finales

Corrida final del 24/11/2026 sobre `claude/IMP-06`:

| Prueba | Inicial | Final |
| --- | --- | --- |
| ESLint | Aprobado | Aprobado |
| Unitarias · `npm test` | 88 | **102 aprobadas** (+14: renovación diaria, despliegue, formato exacto) |
| SQL · `npm run test:db` | 55 | **58 aprobadas** (+3: coherencia, zona horaria, volumen) |
| Build · `npm run build` | Aprobado | Aprobado |
| E2E · `npm run test:e2e` | 60 (Chromium) | **90 aprobadas, 1 omitida** (Chromium: 60 previas + 3 de sesión + 1 de rendimiento + 13 de auditoría visual, teclado, importes y acceso; WebKit: las mismas 13 de auditoría. La omitida es la medición con CDP en WebKit, que no la admite) |
| Responsive | — | Acceso y 14 combinaciones (7 anchos × 2 motores) sin desbordes, áreas táctiles ≥ 44 px, sin errores de consola; foco visible con Tab en 6 pantallas a 375 y 1440 px |
| HTTP públicas · `cifra-development` | 7/7 | **7/7** con la aserción nueva de proveedor único (falló antes de corregir D-01) |
| HTTP autenticadas con sesión real | NOT RUN | **17/17 aprobadas** (arnés en el navegador) + cierre de sesión (403) y JWT vencido (401) |
| Auditoría SQL alojada (solo lectura) | NOT RUN | Sin hallazgos salvo D-08 (§6) |
| Rendimiento móvil emulado (aislado, 3 corridas de 5 cargas) | — | Mediana FCP 1,41–1,45 s · LCP 1,53–1,61 s · Resumen 1,57–1,75 s · 205–207 KiB. Dentro de la suite completa, con 4 procesos en paralelo, LCP 1,84 s |
| `npm audit` | 0 | 0 |

## 13. Limitaciones

- **Teléfono físico: NOT RUN.** Todo lo móvil es emulación (Chromium con `hasTouch` y CPU 4×, WebKit de escritorio).
- **Red real de celular:** las latencias reales se midieron desde la red fija del equipo de desarrollo.
- **Dos plazas reales y tercera identidad:** BLOCKED hasta la intervención del titular; el aislamiento está probado en PostgreSQL embebido con las migraciones reales.
- **Producción:** no existe todavía (Supabase ni Vercel). No se creó, no se aplicaron migraciones ni se desplegó.
- **Volumen alojado:** la tabla alojada está vacía; el volumen se midió en PostgreSQL embebido de un hilo (cota pesimista).

## 14. Cómo reproducir

```sh
npm ci
npx playwright install chromium webkit
npm run lint && npm test && npm run test:db && npm run build
npm run test:e2e                     # Chromium completo + auditoría visual en WebKit
CIFRA_AUDIT_CAPTURES=1 npx playwright test tests/e2e/audit-responsive.spec.js   # capturas en test-results/audit
```

HTTP alojadas: `CIFRA_RUN_HOSTED_TESTS=1` con `CIFRA_TEST_SUPABASE_URL` y `CIFRA_TEST_SUPABASE_PUBLISHABLE_KEY` (IMP-01). Arnés autenticado: con `npm run dev` y la sesión iniciada, en la consola del navegador:

```js
const { supabase } = await import('/src/lib/supabase.js');
const { runHostedAudit } = await import('/tests/integration/hosted-session.audit.js');
await runHostedAudit(supabase);
```

La suite E2E reescribe las capturas de IMP-02 a IMP-05; restaurarlas con `git checkout -- docs/imp-0*/capturas` si no se quiere actualizarlas.
