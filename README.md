# App Finanzas Personales

Aplicación web personal para **registrar, organizar y analizar gastos**, pensada inicialmente para dos usuarios.

> **Estado:** planificación de la versión 1 (V1). Este documento define el alcance; las funcionalidades todavía no están implementadas.

**Especificación detallada:** [Requisitos funcionales V1](docs/requisitos-v1.md) (requisitos numerados, criterios de aceptación y decisiones pendientes).

La [arquitectura técnica propuesta para la V1](docs/arquitectura-v1.md) está disponible para aprobación.

## Versión 1 — Alcance funcional

### 1. Registro de gastos
- Registrar gastos con **importe, fecha, moneda (UYU/USD/EUR) y categoría**.
- Seleccionar una **subcategoría** cuando corresponda y agregar una **descripción opcional**.
- **Editar y eliminar** gastos registrados.
- La aplicación registra **solo gastos**, no ingresos ni saldos.

### 2. Categorías y subcategorías
- Conservar las **13 categorías originales de gastos** y sus subcategorías predefinidas, sin categorías de ingresos.
- Permitir **crear nuevas categorías y subcategorías**, también desde el formulario de gasto.
- Poder **renombrar, archivar y restaurar** categorías y subcategorías sin perder los gastos históricos asociados.

### 3. Estadísticas y gráficos
- Utilizar un **selector compartido UYU / USD / EUR** en Resumen, Estadísticas y Presupuestos, recordado por usuario: los gráficos y totales muestran **solo la moneda seleccionada**, sin conversiones.

Mantener el alcance de estadísticas que ya se había definido para la aplicación anterior, enfocado exclusivamente en gastos:

- **Distribución por categoría y subcategoría**.
- **Evolución mensual** de gastos y **comparaciones entre períodos**.
- **Evolución anual de gastos por categoría** mediante **gráfico de líneas interactivo**: elegir categoría y moneda, comparar los últimos cinco años y navegar hacia años anteriores; identificar el año en curso como parcial.
- **Indicadores, gráficos de barras mensuales, barras por categoría, comparaciones entre períodos y por categoría**, desglose a gastos y resumen descriptivo basado solo en datos registrados.
- Vistas **«Todas» y «Mis favoritos»** para los paneles de Estadísticas.
- **Filtros** por fechas, categorías y subcategorías.
- **Gráficos interactivos** que muestren importes y permitan explorar los gastos relacionados.

### 4. Presupuestos
- Crear **presupuestos mensuales por categoría y moneda**, calculados automáticamente con los gastos registrados en esa categoría y sus subcategorías.
- Mostrar **límite, monto gastado, importe restante y porcentaje utilizado**.
- Cada mes comienza un nuevo conteo, con el mismo límite hasta que el usuario lo cambie o elimine.
- **Sin historial de límites ni presupuestos por subcategoría** en la V1.

### 5. Historial
- Consultar la lista de gastos.
- **Buscar, filtrar y ordenar** los registros.
- Acceder a las opciones de **edición y eliminación**.

### 6. Acceso privado
- Acceso **solo con Google** mediante **Supabase Auth**, limitado a **dos cuentas autorizadas**.
- Sin formulario de contraseña ni recuperación de contraseñas propias; recuperación de la cuenta a través de Google.
- Alta inicial controlada de ambas identidades y deshabilitación posterior de nuevas altas en Supabase; **Express verifica sesión y autorización** en cada operación privada.
- **Información separada** para cada usuario.

## Fuera del alcance de la V1

No implementar por ahora: ingresos, cuentas y saldos bancarios, transferencias, tarjetas de crédito, préstamos, inversiones, fondos y metas de ahorro, compras en cuotas, gastos recurrentes, gestión de gastos compartidos ni otras funciones financieras adicionales.

Podrán evaluarse más adelante, pero **no deben agregarse a la V1 sin una decisión explícita**.

## Tecnologías elegidas como punto de partida

| Área | Tecnología |
| --- | --- |
| Frontend | React + Vite |
| Backend / API | Node.js + Express |
| Lenguaje | JavaScript |
| Base de datos | PostgreSQL en Supabase |
| ORM | Sequelize |
| Autenticación | Supabase Auth + Google |
| Despliegue | Vercel |

PostgreSQL y la autenticación se gestionarán mediante Supabase, manteniendo Sequelize para las consultas y modelos propios. La aplicación seguirá una estructura clara y sencilla, inspirada en el proyecto académico `lugares-fullstack`, con responsabilidades separadas (rutas, controladores, servicios, modelos y acceso a datos).

## Estado de la planificación

Las **cinco decisiones funcionales principales de la V1 están cerradas** y documentadas en [Requisitos funcionales V1](docs/requisitos-v1.md). El siguiente paso es definir el diseño técnico y las configuraciones de Supabase Auth, PostgreSQL y despliegue, además del diseño visual. **Todavía no se ha implementado la aplicación**.

**Criterio de desarrollo:** empezar por lo esencial, mantener el código comprensible y organizado, probar cada funcionalidad antes de incorporar otra y no añadir complejidad pensando en funciones futuras.
