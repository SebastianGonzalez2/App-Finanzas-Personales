# Requisitos funcionales — Versión 1 (V1)

**Producto:** App Finanzas Personales — aplicación web de registro y análisis de gastos personales.  
**Estado:** especificación inicial para revisión; no significa que estas funciones estén desarrolladas.  
**Última revisión:** 23/11/2026.\
**Documento principal:** [README](../README.md).

## 1. Objetivo y límites

Crear una aplicación **simple, rápida y comprensible**, inicialmente para dos personas, que permita registrar lo gastado, clasificarlo, consultar estadísticas y controlar presupuestos. **No administra el dinero disponible ni movimientos bancarios:** registrar un gasto no descuenta dinero de una cuenta.

Reglas de alcance:

- Solo existen **gastos**, introducidos manualmente. No hay ingresos ni saldos financieros.
- La V1 admite **UYU, USD y EUR, sin conversiones automáticas**. Cada gasto conserva su moneda original. **Resumen, Estadísticas y Presupuestos comparten un selector UYU / USD / EUR**, que muestra únicamente los datos de la moneda elegida en sus indicadores y gráficos; las preferencias de moneda se recuerdan por usuario. Nunca sumar importes de monedas diferentes ni mostrar un total consolidado multimoneda. El Historial puede mostrar gastos de distintas monedas en una lista, con el código de cada moneda visible.
- Cada persona entra con su propia cuenta y ve **únicamente sus datos**.
- Los gráficos y presupuestos se calculan a partir de los gastos efectivamente registrados; no se inventan movimientos ni estimaciones.
- Se conservan **categorías y subcategorías**, los gráficos por categoría, la evolución mensual, la evolución anual por categoría y la comparación entre períodos.
- Primero se construye esta V1. Las funciones futuras no deben influir en su complejidad.

**Convención:** `RF` significa requisito funcional. Cada requisito lleva una comprobación observable; su numeración es **nueva** y no coincide con la del proyecto anterior. Los ejemplos son datos ficticios.

## 2. Requisitos funcionales

### A. Usuarios y acceso privado

**RF-001 — Acceso de usuarios autorizados con Google.** La aplicación permitirá iniciar sesión **únicamente mediante Google**, utilizando **Supabase Auth** como servicio de autenticación. La V1 está destinada a **dos identidades de Google autorizadas** (el titular y su padre). No tendrá formulario de contraseña propia, creación pública de cuentas ni proveedores adicionales.

- **Aceptación:** una de las dos identidades autorizadas puede acceder mediante Google; una identidad no autorizada no recibe acceso a ninguna API ni a datos privados, aunque tenga una cuenta Google válida.

**RF-002 — Sesiones, salida y recuperación de acceso.** Supabase Auth gestionará la sesión de Google y su renovación mediante mecanismos soportados. La aplicación permitirá cerrar sesión. **No implementará recuperación de contraseña propia:** si un usuario pierde acceso a su cuenta Google, utilizará los mecanismos de recuperación de Google.

- **Aceptación:** una sesión válida permite continuar usando la aplicación; una sesión ausente, inválida o expirada no permite leer ni cambiar datos. Después de cerrar sesión, la aplicación deja de permitir operaciones privadas con esa sesión.

**RF-003 — Independencia de datos y autorización.** Gastos, categorías, presupuestos, estadísticas y preferencias serán privados para cada usuario. En cada operación privada, la Data API verificará el token de Supabase Auth. La función RPC comprobará en PostgreSQL que el UUID autenticado ocupa una de las dos plazas y que la sesión exacta del token sigue vigente. Las políticas RLS limitarán el acceso a las filas de su propietario. La verificación del servidor no dependerá de botones ocultos ni de datos de identidad enviados libremente por el cliente.

- **Aceptación:** el usuario A no puede leer, editar ni eliminar un gasto o presupuesto del usuario B, ni cambiando el identificador en una petición. Una identidad Google externa, aunque consiga autenticarse con Supabase, recibe acceso denegado al invocar una operación privada de la Data API.

**Regla de configuración — Alta privada de las dos identidades.** El acceso inicial se habilitará administrativamente para las dos cuentas de Google elegidas, sin una interfaz pública de inscripción. Una vez creadas y verificadas esas dos identidades en Supabase Auth, se **deshabilitarán las nuevas altas**. PostgreSQL conservará en un esquema privado una **lista de autorización explícita** de los identificadores de usuario de Supabase correspondientes, sin publicar correos ni identificadores privados en este repositorio. No se abrirá un panel de administración de usuarios para la V1.

- **Aceptación:** después de habilitar las dos identidades, otra cuenta Google no puede crear una cuenta nueva en Supabase Auth ni acceder a los datos de la aplicación. Una cuenta existente que no esté autorizada también es rechazada por los RPC de la Data API.

### B. Registro y mantenimiento de gastos

**RF-004 — Crear un gasto.** Un usuario autenticado podrá registrar un gasto indicando **importe, moneda (UYU, USD o EUR), fecha y categoría**; podrá indicar una **subcategoría** y una **descripción**, ambas opcionales. El formulario será breve y fácil de utilizar desde un celular.

- **Aceptación:** guardar un gasto válido lo muestra en el historial y actualiza las estadísticas y presupuestos del período correspondiente.

**RF-005 — Validación.** El sistema rechazará importes nulos, negativos o inválidos, monedas distintas de UYU/USD/EUR y fechas inexistentes. La subcategoría seleccionada deberá pertenecer a la categoría indicada. Mostrará un error comprensible sin descartar innecesariamente lo ingresado.

- **Aceptación:** no se persiste un gasto de importe cero ni una subcategoría perteneciente a otra categoría.

**RF-006 — Fecha efectiva del gasto.** Se podrá registrar un gasto de un día anterior. Los totales se calcularán según la **fecha asignada al gasto**, no según el día en que fue cargado.

- **Aceptación:** un gasto con fecha de octubre que se registra en noviembre aparece en las estadísticas de octubre, no en las de noviembre.

**RF-007 — Editar un gasto.** Un usuario podrá modificar los datos de uno de sus gastos guardados.

- **Aceptación:** cambiar importe, fecha o categoría actualiza el historial, los gráficos y los presupuestos afectados **sin duplicar el gasto**, también si se cambia de mes.

**RF-008 — Eliminar un gasto.** Un usuario podrá eliminar un gasto propio mediante una acción identificable y confirmada.

- **Aceptación:** el gasto deja de aparecer en el historial y deja de contar en estadísticas y presupuestos; no afecta gastos ajenos.

**RF-009 — Guardado fiable.** El sistema confirmará un guardado solo cuando la información haya quedado persistida; deberá evitar registros duplicados por doble clic o reintento accidental.

- **Aceptación:** al enviar dos veces accidentalmente el mismo formulario no aparecen dos gastos; ante un error de red no se presenta un éxito falso.

### C. Categorías y subcategorías

**RF-010 — Catálogo inicial.** Cada usuario tendrá al iniciar las **13 categorías de gastos del proyecto anterior**, con las subcategorías iniciales aprobadas, sin categorías de ingresos. El catálogo será independiente para cada usuario.

- **Aceptación:** una cuenta nueva presenta las 13 categorías de la tabla siguiente y sus subcategorías iniciales, sin categorías de ingresos ni categorías de otro usuario.

| Categoría | Subcategorías iniciales |
| --- | --- |
| Alimentación | Supermercado, Restaurantes, Delivery |
| Vivienda | Alquiler, Mantenimiento |
| Servicios | — |
| Transporte | Transporte público, Taxi/Uber |
| Auto | — |
| Salud | — |
| Educación | — |
| Ropa | Ropa, Calzado |
| Entretenimiento | — |
| Viajes | — |
| Seguros | — |
| Impuestos | — |
| Otros gastos | — |

Las categorías sin subcategorías predefinidas admiten subcategorías nuevas creadas por el usuario.

**RF-011 — Crear categorías.** El usuario podrá crear categorías propias y subcategorías bajo una categoría existente, tanto desde la sección de categorías como, cuando corresponda, desde el formulario de gasto.

- **Aceptación:** crear una categoría mientras se registra un gasto conserva los datos ya ingresados, permite seleccionarla y **no guarda el gasto** hasta confirmar el formulario.

**RF-012 — Administrar categorías.** El usuario podrá consultar, **renombrar y archivar** sus categorías y subcategorías, y restaurar las archivadas. Archivar impide utilizarlas normalmente en gastos nuevos, pero no elimina ni altera los gastos históricos asociados.

- **Aceptación:** una categoría archivada deja de aparecer como opción normal para nuevos gastos, pero sus gastos históricos siguen visibles y contabilizados; renombrarla no cambia importes ni borra registros. Archivar una categoría principal también impide seleccionar sus subcategorías para gastos nuevos.

**RF-013 — Coherencia de la jerarquía.** La clasificación tendrá **dos niveles**: categoría y subcategoría opcional. No se crearán subcategorías huérfanas ni se permitirán duplicados accidentales por diferencias triviales de espacios o mayúsculas.

- **Aceptación:** una subcategoría siempre pertenece a una categoría válida; los totales de una categoría contemplan sus subcategorías sin duplicar importes.

### D. Historial y consulta

**RF-014 — Listado de gastos.** El sistema mostrará los gastos del usuario con fecha, **importe y moneda**, categoría, subcategoría cuando exista y descripción cuando haya sido ingresada. Permitirá abrir un registro para editarlo o eliminarlo.

- **Aceptación:** un gasto recién guardado es consultable y sus datos coinciden con los registrados.

**RF-015 — Búsqueda y filtros.** El historial permitirá buscar por descripción y filtrar al menos por período o rango de fechas, categoría y subcategoría. Se podrán limpiar los filtros.

- **Aceptación:** filtrar por noviembre y Alimentación devuelve exclusivamente los gastos que coincidan con ambos criterios.

**RF-016 — Ordenamiento y resultados.** El historial permitirá ordenar por fecha e importe y mostrará claramente los casos sin resultados. Si hay muchos registros, la navegación seguirá siendo utilizable sin cargar innecesariamente todo el historial.

- **Aceptación:** ordenar por importe muestra el orden correcto en el conjunto filtrado; un filtro sin coincidencias informa «Sin resultados» sin borrar datos.

### E. Estadísticas y gráficos

**RF-017 — Indicadores del período.** La sección Estadísticas mostrará el **total gastado y la cantidad de gastos de la moneda seleccionada (UYU, USD o EUR)** en el período elegido, junto con comparaciones del gasto frente al período de referencia cuando sea posible. No existirá un total único que sume monedas distintas.

- **Aceptación:** con gastos de UYU 100, UYU 200 y USD 300, el selector UYU muestra total UYU 300 y dos gastos; al cambiar a USD muestra USD 300 y un gasto. **Nunca** aparece un total ficticio de 600 en una única moneda.

**RF-018 — Gastos por categoría y subcategoría.** Se conservará el **gráfico de barras por categoría** del proyecto anterior, con importe, cantidad de gastos y participación sobre el total. Se podrá consultar el detalle por subcategoría y la **comparación por categoría entre períodos** (importe y variación cuando haya base válida). Importes y porcentajes se calcularán **solamente con los gastos de la moneda seleccionada**. Un gráfico nunca mezcla importes UYU, USD y EUR.

- **Aceptación:** dos subcategorías de Alimentación con gastos de 200 y 300 muestran Alimentación = 500, no 1.000; sus porcentajes corresponden al total real.

**RF-019 — Evolución mensual.** Se conservará el **gráfico de barras de gastos por mes** de la aplicación anterior, **en la moneda seleccionada**, con importes mensuales visibles o consultables, posibilidad de observar la evolución y comparación entre meses o períodos equivalentes **de esa misma moneda** cuando existan datos.

- **Aceptación:** gastos registrados en octubre y noviembre aparecen en los meses correctos; si el período de referencia tiene total cero, no se muestra un porcentaje de variación matemáticamente inválido.

**RF-020 — Evolución anual y por categoría (prioridad funcional alta).** Se conservará el gráfico **«Evolución anual por categoría»** de la aplicación anterior como **gráfico de líneas**, para conocer cuánto se gastó en una categoría determinada en cada año. El usuario podrá elegir **cualquier categoría**, incluida su clasificación por subcategorías, o **todas las categorías** para analizar el gasto anual general. La ventana inicial será de **cinco años, terminando en el año actual**, con su propio selector de años independiente del período general de Estadísticas y navegación a bloques de años anteriores y más recientes. La serie, los importes y las comparaciones mostrarán **solo la moneda seleccionada**. Cada punto permitirá conocer el año y su gasto exacto.

- **Aceptación:** al seleccionar Alimentación y UYU se muestran importes anuales separados para 2023, 2024, 2025 y 2026 cuando haya registros de esos años; los totales de Alimentación incluyen sus subcategorías una sola vez, sin sumar otras categorías o monedas.
- **Aceptación:** si el año actual no terminó, se identifica como **parcial**. Un año sin registros suficientes se indica como **«Sin registros»**, en lugar de inventar un gasto cero o unir la línea como si se conociera su valor. Se pueden consultar años anteriores a la ventana inicial sin perder los registros históricos.
- **Aceptación:** en un bloque de cinco años, incluso uno anterior, cambiar «Mes actual» por otro período conserva los años y sus importes. Cambiar la moneda o la categoría recalcula la serie en ese mismo bloque.

**RF-021 — Selector de moneda, períodos, filtros y favoritos.** Resumen, Estadísticas y Presupuestos compartirán un **selector UYU / USD / EUR**, cuya elección se recordará por usuario. Al cambiar de moneda se actualizarán **juntos todos los indicadores, gráficos y presupuestos visibles**, sin incorporar importes de las otras monedas. Estadísticas también permitirá elegir períodos habituales (mes actual, mes anterior, últimos 3, 6 y 12 meses, año actual), un rango personalizado y filtros por categoría y subcategoría, así como comparar períodos de la misma moneda. El período general se aplica a los paneles de período. La serie anual comparte los filtros de moneda y clasificación y usa el selector de años de RF-020. Se conservarán las vistas **«Todas»** y **«Mis favoritos»** de la versión anterior para elegir qué paneles estadísticos consultar habitualmente.

- **Aceptación:** al cambiar de UYU a EUR, todas las visualizaciones muestran exclusivamente gastos en EUR; al navegar entre Resumen, Estadísticas y Presupuestos se conserva EUR, y al volver a iniciar sesión se recuerda la elección del usuario.

- **Aceptación:** cambiar el período actualiza conjuntamente los indicadores y gráficos de período, con los rangos comparados visibles. Cambiar la categoría actualiza tanto esos paneles como la serie anual, que conserva su ventana de años. Marcar un panel como favorito lo hace aparecer en «Mis favoritos» solo para ese usuario.

**RF-022 — Interacción y desglose.** Los gráficos mostrarán importe, período y categoría mediante leyendas, etiquetas o información al interactuar (mouse, teclado o toque). Cuando sea pertinente, se podrá acceder desde el gráfico a los gastos que forman un total.

- **Aceptación:** seleccionar la categoría Transporte de un mes permite consultar los gastos de Transporte que componen ese importe; el detalle coincide con el gráfico.

**RF-023 — Consistencia, resumen descriptivo y ausencia de datos.** Indicadores, gráficos, historial y presupuestos utilizarán criterios coherentes, con **monedas siempre identificadas y sin conversiones implícitas**. Se conservará el panel **«Resumen inteligente»** de la aplicación anterior **solo como resumen textual determinista de los gastos realmente registrados**, sin introducir IA generativa ni cifras inventadas. No se fabricarán porcentajes, tendencias o valores cuando falten registros suficientes. Las ediciones y eliminaciones se reflejarán en el período correcto.

- **Aceptación:** editar un gasto de noviembre de 300 a 200 reduce el total de noviembre en 100 en todas las vistas pertinentes; una comparación imposible aparece como «No disponible» o equivalente. Si no hay información suficiente para resumir una tendencia, el resumen lo indica explícitamente, sin generar conclusiones falsas.

**Inventario de estadísticas y visualizaciones de gastos de la V1 (derivado de la aplicación anterior):**

| Panel o visualización | Contenido | Presentación |
| --- | --- | --- |
| Indicadores del período | Total gastado, cantidad de gastos y variación frente a un período comparable | Tarjetas / valores y tabla |
| Gastos por mes | Evolución de gastos durante los meses del período | Gráfico de barras |
| Gastos por categoría | Importe y participación por categoría, con acceso a subcategorías y a movimientos | Barras horizontales y detalle |
| Comparación por categoría | Categorías del período actual frente al elegido como referencia | Tabla comparativa de importes y variaciones |
| Evolución anual por categoría | Gasto anual de la categoría elegida o todas, cinco años visibles inicialmente y navegación histórica | **Gráfico de líneas interactivo, prioritario** |
| Resumen inteligente | Descripción verificable de los gastos registrados, con advertencia si faltan datos | Panel textual determinista |
| Todas / Mis favoritos | Consulta de todos los paneles o de los seleccionados como favoritos | Organización de la vista, privada por usuario |

Se mantienen filtros por fechas, moneda, categoría y subcategoría, y el acceso desde los resultados a los gastos que originaron los valores. **Se excluyen** los gráficos originales de ingresos, medios de pago, saldo o patrimonio, deudas y gastos recurrentes, porque esos datos no forman parte de la V1. El gráfico denominado «Histórico por fecha» del sistema antiguo representaba movimientos financieros y saldos; **no debe copiarse como tal**. La evolución temporal de gastos se cubre mediante los gráficos mensual y anual.

### F. Presupuestos mensuales

**RF-024 — Crear presupuesto por categoría.** El usuario podrá crear un presupuesto eligiendo **una categoría, una moneda (UYU, USD o EUR) y un límite mensual**. El presupuesto es un contador de gastos, no una reserva de dinero ni una operación bancaria. Se mantiene el mismo límite para los meses siguientes hasta que el usuario lo cambie o retire. Para evitar duplicados habrá como máximo un presupuesto activo por categoría y moneda; no se crean presupuestos separados para subcategorías en la V1.

- **Aceptación:** crear Alimentación · UYU 15.000 muestra un presupuesto para esa categoría y moneda, que comienza en cero si todavía no hay gastos registrados en el mes. Si ya existen gastos del mes en esa categoría y moneda, aparecen automáticamente en el contador.

**RF-025 — Seguimiento del presupuesto.** El consumo del presupuesto es **la suma de los gastos registrados en su categoría (incluidas sus subcategorías), moneda y mes**. El contador aumenta automáticamente al registrar gastos, y se recalcula al editar o eliminar alguno. Se mostrarán límite, consumo, importe restante o exceso y porcentaje utilizado. Los gastos de otras monedas no se convierten ni se suman. **Al cambiar de mes, el consumo vuelve a empezar según los gastos registrados en el nuevo mes; el límite se mantiene**, sin acumular importes no gastados del mes anterior.

- **Aceptación:** con límite Alimentación · UYU 15.000, registrar gastos UYU 2.000 y UYU 3.000 deja consumo UYU 5.000 (33,33 %) y disponibles UYU 10.000. Un gasto USD 50 en Alimentación **no altera** ese contador. En el siguiente mes, sin gastos todavía, muestra 0 de 15.000.

**RF-026 — Modificar o retirar presupuestos.** El usuario podrá **modificar el límite** de un presupuesto o retirarlo sin modificar ni eliminar los gastos registrados. En la V1 se controla **el presupuesto del mes actual**; no se implementa una pantalla de historial de límites de presupuestos, ni versiones o excepciones mensuales.

- **Aceptación:** modificar un límite de UYU 15.000 a UYU 18.000 actualiza inmediatamente el porcentaje del mes actual, conservando intactos los gastos; retirar el presupuesto elimina el contador, no los gastos. Las estadísticas de gastos de meses anteriores permanecen consultables sin requerir historial de límites.

### G. Vista inicial

**RF-027 — Resumen sencillo.** Tras entrar, el usuario dispondrá de una vista clara del gasto del mes **en la moneda seleccionada**, su distribución principal por categorías y el estado de sus presupuestos de esa moneda, con acceso rápido a registrar un gasto, al historial y a Estadísticas.

- **Aceptación:** el total del Resumen coincide con Estadísticas para el mismo mes y permite registrar un gasto sin pasos financieros adicionales.

## 3. Condiciones de calidad mínimas (no son nuevas funcionalidades)

- **Privacidad:** autenticación Google gestionada por Supabase Auth, validación del token en la Data API, autorización por plaza y sesión en cada RPC, datos aislados por propietario mediante RLS; **sin contraseñas propias ni registro público**. Secretos y claves de servicio nunca se exponen al navegador.
- **Exactitud monetaria:** almacenar y calcular importes con precisión decimal apropiada, sin errores de coma flotante en totales y presupuestos; mostrar formatos claros.
- **Integridad:** operaciones de alta, edición y eliminación consistentes, sin duplicación por reintentos.
- **Experiencia:** interfaz en español, usable con mouse y teclado en computadora y con pantalla táctil en celular; controles accesibles y mensajes de error claros.
- **Rendimiento:** navegación y desplazamiento fluidos en dispositivos reales. Medir tiempos de carga y fluidez desde el primer incremento; los gráficos y efectos decorativos no deben comprometer la interacción.
- **Calidad del código:** separación comprensible entre interfaz, servicios de acceso a la Data API, funciones RPC y políticas RLS; pruebas automáticas para gastos, permisos, agregaciones, presupuestos y cambios históricos.
- **Conectividad:** la V1 funciona en línea; ante pérdida de conexión no promete guardar datos que el servidor no confirmó.

## 4. Exclusiones expresas de la V1

No construir: **ingresos; saldos y cuentas bancarias; transferencias; tarjetas y deudas; préstamos; inversiones; fondos o metas de ahorro; compras en cuotas; recurrentes; reembolsos; gastos compartidos; etiquetas; catálogo de comercios; adjuntos y OCR; carga por voz o IA; operaciones offline; exportaciones PDF/Excel/CSV; backups/restauración personalizados; estadísticas de patrimonio o de ingresos**.

La ausencia de esas funciones es deliberada. Se podrán reconsiderar en otra versión, pero ningún agente debe agregarlas por iniciativa propia.

## 5. Decisiones cerradas

- **D-01 — Monedas y visualización (aprobada):** UYU, USD y EUR sin cotizaciones ni conversiones. Un **único selector compartido** entre Resumen, Estadísticas y Presupuestos muestra solamente importes de la moneda elegida y la preferencia se recuerda por usuario. El Historial puede listar monedas diferentes identificadas por su código, sin sumarlas. No se incorpora un motor de tipo de cambio.
- **D-02 — Categorías y subcategorías (aprobada):** recuperar las 13 categorías originales de gastos y sus subcategorías iniciales, sin categorías de ingresos. Cada usuario puede crear, renombrar, archivar y restaurar categorías y subcategorías propias, preservando los gastos históricos. Dos niveles como máximo.
- **D-03 — Presupuestos (aprobada):** un presupuesto es un límite mensual elegido para una **categoría y moneda**, con contador automático de gastos de esa categoría y subcategorías. El consumo se calcula para el mes actual y vuelve a cero al pasar al siguiente mes si no hay gastos; el límite se conserva hasta cambiarlo. No hay presupuestos separados por subcategoría, acumulación de sobrantes, pagos recurrentes, excepciones mensuales ni historial de límites en V1. Las estadísticas históricas de gastos se conservan.
- **D-04 — Estadísticas y gráficos (aprobada):** se conservan todos los paneles del proyecto anterior que analizan exclusivamente **gastos**, incluido el gráfico **de líneas «Evolución anual por categoría»**, prioritario y con selección de categoría/moneda. Se muestran cinco años por defecto (hasta el año actual), con navegación a otros años, detalle de valores y marca de año parcial. Incluye indicadores, barras mensuales, barras por categoría, comparaciones por categoría y período, desglose hasta gastos, panel descriptivo determinista y «Todas / Mis favoritos». Se eliminan únicamente las visualizaciones basadas en módulos excluidos de la V1.
- **D-05 — Autenticación y usuarios (aprobada):** solo **Google Sign-In con Supabase Auth** para dos identidades autorizadas. Sin contraseñas propias, reset por correo, inscripción pública ni desarrollo de un sistema casero de autenticación. Alta inicial controlada de las dos identidades y luego nuevas altas deshabilitadas en Supabase. La Data API verifica el token y cada RPC exige plaza habilitada y sesión vigente del JWT. PostgreSQL aplica RLS por propietario. Recuperación de la cuenta Google mediante Google; autorización independiente de la sola autenticación.

## 6. Estado de la definición funcional

Las **cinco decisiones de alcance están cerradas** (D-01 a D-05). La especificación funcional de la V1 queda lista como base del diseño técnico, **sin implicar que el código esté implementado**.

La [arquitectura V1](arquitectura-v1.md) define el acceso Google, la incorporación de ambas identidades, el modelo PostgreSQL, los permisos RLS, los contratos RPC y sus pruebas. Estas decisiones de implementación **no autorizan agregar funcionalidades fuera de la V1**.

**Infraestructura elegida:** React + Vite con JavaScript, Supabase Auth con Google, Data API y funciones RPC en PostgreSQL con RLS. Vercel sirve la aplicación web. La configuración y la verificación de estos servicios corresponden a la implementación.

## 7. Referencias de origen

Este documento adapta selectivamente el proyecto anterior [finanzas-personales](https://github.com/SebastianGonzalez2/finanzas-personales):

- [Alcance y requisitos originales](https://github.com/SebastianGonzalez2/finanzas-personales/blob/main/docs/planning/01-alcance-y-requisitos.md): principalmente RF-004, RF-006, RF-010/011, RF-031, RF-039 y RF-044/045, **reescritos**.
- [Criterios de aceptación originales](https://github.com/SebastianGonzalez2/finanzas-personales/blob/main/docs/planning/03-criterios-de-aceptacion.md): casos de privacidad, historial, presupuestos, categorías y estadísticas, sin copiar dependencias financieras obsoletas.
- [Modelo de estadísticas de la app anterior](https://github.com/SebastianGonzalez2/finanzas-personales/blob/main/src/domain/statistics.ts): períodos, categorías, comparación y evolución anual.
- [Catálogo de categorías anterior](https://github.com/SebastianGonzalez2/finanzas-personales/blob/main/docs/planning/47-catalogo-categorias-f5-01.md).

**Regla de precedencia:** si un documento antiguo contradice esta V1, rige **este documento** para el proyecto nuevo. No copiar código, esquemas ni funcionalidades antiguas por el solo hecho de que existen.
