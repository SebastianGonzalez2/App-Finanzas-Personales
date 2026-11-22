# Requisitos funcionales — Versión 1 (V1)

**Producto:** App Finanzas Personales — aplicación web de registro y análisis de gastos personales.  
**Estado:** especificación inicial para revisión; no significa que estas funciones estén desarrolladas.  
**Última revisión:** 22/11/2026.  
**Documento principal:** [README](../README.md).

## 1. Objetivo y límites

Crear una aplicación **simple, rápida y comprensible**, inicialmente para dos personas, que permita registrar lo gastado, clasificarlo, consultar estadísticas y controlar presupuestos. **No administra el dinero disponible ni movimientos bancarios:** registrar un gasto no descuenta dinero de una cuenta.

Reglas de alcance:

- Solo existen **gastos**, introducidos manualmente. No hay ingresos ni saldos financieros.
- La V1 admite **UYU, USD y EUR, sin conversiones automáticas**. Cada gasto conserva su moneda original; totales, gráficos y presupuestos se calculan y muestran **por separado para cada moneda**. Nunca sumar importes de monedas diferentes ni mostrar un total consolidado multimoneda.
- Cada persona entra con su propia cuenta y ve **únicamente sus datos**.
- Los gráficos y presupuestos se calculan a partir de los gastos efectivamente registrados; no se inventan movimientos ni estimaciones.
- Se conservan **categorías y subcategorías**, los gráficos por categoría, la evolución mensual, la evolución anual por categoría y la comparación entre períodos.
- Primero se construye esta V1. Las funciones futuras no deben influir en su complejidad.

**Convención:** `RF` significa requisito funcional. Cada requisito lleva una comprobación observable; su numeración es **nueva** y no coincide con la del proyecto anterior. Los ejemplos son datos ficticios.

## 2. Requisitos funcionales

### A. Usuarios y acceso privado

**RF-001 — Acceso de usuarios autorizados.** El sistema permitirá iniciar sesión con correo electrónico y contraseña a las dos cuentas autorizadas para la aplicación. No ofrecerá registro público ni acceso a personas no autorizadas.

- **Aceptación:** una cuenta autorizada puede entrar con credenciales correctas; una cuenta no autorizada o una contraseña incorrecta no permite entrar.

**RF-002 — Sesión y cierre de sesión.** El sistema mantendrá una sesión autenticada hasta su vencimiento o cierre y permitirá cerrar sesión explícitamente. Las pantallas y operaciones de gastos deberán estar protegidas.

- **Aceptación:** después de cerrar sesión, intentar acceder directamente a una página o a la API de gastos no devuelve información privada.

**RF-003 — Independencia de datos.** Gastos, categorías, presupuestos y estadísticas serán privados para cada usuario. El servidor verificará siempre la identidad y la titularidad de cada recurso.

- **Aceptación:** el usuario A no puede leer, editar ni eliminar un gasto o presupuesto del usuario B, ni cambiando el identificador en una petición.

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

**RF-010 — Catálogo inicial.** Cada usuario dispondrá de categorías y subcategorías predeterminadas para clasificar gastos. El catálogo exacto se definirá antes de implementarlo, utilizando como referencia el proyecto anterior.

- **Aceptación:** una cuenta nueva presenta las categorías aprobadas, sin categorías de ingresos.

**RF-011 — Crear categorías.** El usuario podrá crear categorías propias y subcategorías bajo una categoría existente, tanto desde la sección de categorías como, cuando corresponda, desde el formulario de gasto.

- **Aceptación:** crear una categoría mientras se registra un gasto conserva los datos ya ingresados, permite seleccionarla y **no guarda el gasto** hasta confirmar el formulario.

**RF-012 — Administrar categorías.** El usuario podrá consultar y modificar los nombres de sus categorías y subcategorías, y dejar de utilizarlas para gastos futuros sin perder los registros históricos.

- **Aceptación:** una categoría desactivada deja de aparecer como opción normal para nuevos gastos, pero los gastos históricos conservan su clasificación y son visibles.

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

**RF-017 — Indicadores del período.** La sección Estadísticas mostrará el **total gastado separado por moneda (UYU, USD, EUR)** y la cantidad de gastos en el período elegido, además de datos suficientes para interpretar el resultado. No existirá un total único que sume monedas distintas.

- **Aceptación:** tres gastos de UYU 100, UYU 200 y USD 300 muestran UYU 300, USD 300 y tres registros; **nunca** aparece un total ficticio de 600 en una única moneda.

**RF-018 — Gastos por categoría y subcategoría.** Se mostrarán gráficos y valores de distribución por categoría, y será posible consultar el detalle por subcategoría. Se incluirán importes y porcentajes calculados **dentro de cada moneda**, sin mezclar UYU, USD y EUR.

- **Aceptación:** dos subcategorías de Alimentación con gastos de 200 y 300 muestran Alimentación = 500, no 1.000; sus porcentajes corresponden al total real.

**RF-019 — Evolución mensual.** Se mostrará un gráfico de gastos por mes, **diferenciando las monedas**, con posibilidad de observar la evolución y comparar el mes seleccionado con otro período equivalente **de la misma moneda** cuando existan datos.

- **Aceptación:** gastos registrados en octubre y noviembre aparecen en los meses correctos; si el período de referencia tiene total cero, no se muestra un porcentaje de variación matemáticamente inválido.

**RF-020 — Evolución anual y por categoría.** Se conservará el análisis **anual** que se había definido en la aplicación anterior: totales por año, evolución histórica entre años y **evolución anual por categoría**, con gráficos apropiados, incluidos gráficos de líneas. Las series, importes y comparaciones **deben identificar su moneda** y no sumar monedas distintas.

- **Aceptación:** al consultar distintos años o una categoría, la serie incluye únicamente los registros que correspondan a esos años y a esa categoría; los años sin datos no se presentan como gastos inventados.

**RF-021 — Períodos, comparaciones y filtros estadísticos.** Estadísticas permitirá **seleccionar o separar UYU/USD/EUR**, y elegir períodos habituales (mes actual, mes anterior, últimos 3, 6 y 12 meses, año actual), un rango personalizado y filtros por categoría y subcategoría. También permitirá comparar los valores con un período de referencia claramente identificado.

- **Aceptación:** cambiar el período o la categoría actualiza conjuntamente indicadores y gráficos, y se distingue visualmente qué períodos se comparan.

**RF-022 — Interacción y desglose.** Los gráficos mostrarán importe, período y categoría mediante leyendas, etiquetas o información al interactuar (mouse, teclado o toque). Cuando sea pertinente, se podrá acceder desde el gráfico a los gastos que forman un total.

- **Aceptación:** seleccionar la categoría Transporte de un mes permite consultar los gastos de Transporte que componen ese importe; el detalle coincide con el gráfico.

**RF-023 — Consistencia y ausencia de datos.** Indicadores, gráficos, historial y presupuestos utilizarán criterios coherentes, con **monedas siempre identificadas y sin conversiones implícitas**. No se fabricarán porcentajes, tendencias o valores cuando falten registros suficientes. Las ediciones y eliminaciones se reflejarán en el período correcto.

- **Aceptación:** editar un gasto de noviembre de 300 a 200 reduce el total de noviembre en 100 en todas las vistas pertinentes; una comparación imposible aparece como «No disponible» o equivalente.

### F. Presupuestos mensuales

**RF-024 — Crear presupuesto por categoría.** El usuario podrá definir un **límite de gasto mensual y su moneda (UYU, USD o EUR)** para una categoría propia. Los presupuestos son opcionales y no representan dinero reservado ni saldos bancarios.

- **Aceptación:** un límite mensual de Alimentación de 2.000 se muestra como presupuesto de esa categoría en el mes correspondiente.

**RF-025 — Seguimiento del presupuesto.** Para cada presupuesto el sistema mostrará el límite, los gastos imputados al mes **en la misma moneda del presupuesto**, el saldo restante o exceso y el porcentaje utilizado. Los gastos de subcategorías se incluyen en el presupuesto de su categoría superior **una sola vez**. Los gastos de otras monedas no se convierten ni se suman al consumo de ese presupuesto.

- **Aceptación:** con límite 2.000 y gastos de 1.500 en Alimentación (incluidas subcategorías), muestra 75 % utilizado y 500 restantes; con 2.200 muestra exceso de 200.

**RF-026 — Modificar o retirar presupuestos.** El usuario podrá editar el límite y retirar un presupuesto. Los gastos no se modificarán por editar o eliminar su límite.

- **Aceptación:** modificar un presupuesto de 2.000 a 3.000 cambia su porcentaje de uso, pero no el total de gastos. La regla de conservación de presupuestos históricos se especificará antes de programar esta función.

### G. Vista inicial

**RF-027 — Resumen sencillo.** Tras entrar, el usuario dispondrá de una vista clara del gasto del mes, su distribución principal por categorías y el estado de sus presupuestos, con acceso rápido a registrar un gasto, al historial y a Estadísticas.

- **Aceptación:** el total del Resumen coincide con Estadísticas para el mismo mes y permite registrar un gasto sin pasos financieros adicionales.

## 3. Condiciones de calidad mínimas (no son nuevas funcionalidades)

- **Privacidad:** autorización de todas las operaciones en el servidor, datos aislados entre usuarios y contraseñas protegidas con mecanismos probados; sin registro público.
- **Exactitud monetaria:** almacenar y calcular importes con precisión decimal apropiada, sin errores de coma flotante en totales y presupuestos; mostrar formatos claros.
- **Integridad:** operaciones de alta, edición y eliminación consistentes, sin duplicación por reintentos.
- **Experiencia:** interfaz en español, usable con mouse y teclado en computadora y con pantalla táctil en celular; controles accesibles y mensajes de error claros.
- **Rendimiento:** navegación y desplazamiento fluidos en dispositivos reales. Medir tiempos de carga y fluidez desde el primer incremento; los gráficos y efectos decorativos no deben comprometer la interacción.
- **Calidad del código:** separación comprensible entre interfaz, rutas, controladores, servicios, modelos y acceso a datos; pruebas automáticas para gastos, permisos, agregaciones, presupuestos y cambios históricos.
- **Conectividad:** la V1 funciona en línea; ante pérdida de conexión no promete guardar datos que el servidor no confirmó.

## 4. Exclusiones expresas de la V1

No construir: **ingresos; saldos y cuentas bancarias; transferencias; tarjetas y deudas; préstamos; inversiones; fondos o metas de ahorro; compras en cuotas; recurrentes; reembolsos; gastos compartidos; etiquetas; catálogo de comercios; adjuntos y OCR; carga por voz o IA; operaciones offline; exportaciones PDF/Excel/CSV; backups/restauración personalizados; estadísticas de patrimonio o de ingresos**.

La ausencia de esas funciones es deliberada. Se podrán reconsiderar en otra versión, pero ningún agente debe agregarlas por iniciativa propia.

## 5. Decisiones cerradas

- **D-01 — Monedas (aprobada):** UYU, USD y EUR, **sin cotización ni conversión automática** en V1. El importe original se conserva en su moneda. Historial, indicadores, estadísticas, gráficos y presupuestos identifican la moneda y muestran sus importes separados. Se prohíbe sumar monedas diferentes. No se incorpora un motor de tipo de cambio.

## 6. Decisiones pendientes antes de implementar los módulos afectados

Estas cuestiones **no quedan aprobadas por este documento**. Deben resolverse antes de diseñar el esquema o programar las funciones correspondientes:

2. **Catálogo inicial:** nombres concretos de categorías y subcategorías del proyecto anterior que vamos a conservar.
3. **Presupuestos:** si el límite se define para un mes concreto o se repite mes a mes; qué sucede con el historial cuando se cambia o elimina el límite; si habrá presupuestos específicos de subcategoría.
4. **Gráficos anuales:** ventana temporal predeterminada y modo exacto de navegación entre años; los tipos de gráfico y la evolución anual por categoría sí forman parte de la V1.
5. **Cuentas:** confirmar en el diseño técnico el procedimiento de creación y recuperación de acceso para las dos personas, sin registro público.

Hasta que se resuelvan, **no inventar comportamientos** ni ampliar el alcance para resolverlos.

## 7. Referencias de origen

Este documento adapta selectivamente el proyecto anterior [finanzas-personales](https://github.com/SebastianGonzalez2/finanzas-personales):

- [Alcance y requisitos originales](https://github.com/SebastianGonzalez2/finanzas-personales/blob/main/docs/planning/01-alcance-y-requisitos.md): principalmente RF-004, RF-006, RF-010/011, RF-031, RF-039 y RF-044/045, **reescritos**.
- [Criterios de aceptación originales](https://github.com/SebastianGonzalez2/finanzas-personales/blob/main/docs/planning/03-criterios-de-aceptacion.md): casos de privacidad, historial, presupuestos, categorías y estadísticas, sin copiar dependencias financieras obsoletas.
- [Modelo de estadísticas de la app anterior](https://github.com/SebastianGonzalez2/finanzas-personales/blob/main/src/domain/statistics.ts): períodos, categorías, comparación y evolución anual.
- [Catálogo de categorías anterior](https://github.com/SebastianGonzalez2/finanzas-personales/blob/main/docs/planning/47-catalogo-categorias-f5-01.md).

**Regla de precedencia:** si un documento antiguo contradice esta V1, rige **este documento** para el proyecto nuevo. No copiar código, esquemas ni funcionalidades antiguas por el solo hecho de que existen.
