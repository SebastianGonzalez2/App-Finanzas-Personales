# App Finanzas Personales

Aplicación web personal para **registrar, organizar y analizar gastos**, pensada inicialmente para dos usuarios.

> **Estado:** planificación de la versión 1 (V1). Este documento define el alcance; las funcionalidades todavía no están implementadas.

**Especificación detallada:** [Requisitos funcionales V1](docs/requisitos-v1.md) (requisitos numerados, criterios de aceptación y decisiones pendientes).

## Versión 1 — Alcance funcional

### 1. Registro de gastos
- Registrar gastos con **importe, fecha, moneda (UYU/USD/EUR) y categoría**.
- Seleccionar una **subcategoría** cuando corresponda y agregar una **descripción opcional**.
- **Editar y eliminar** gastos registrados.
- La aplicación registra **solo gastos**, no ingresos ni saldos.

### 2. Categorías y subcategorías
- Contar con **categorías y subcategorías predefinidas**, tomando como referencia las que se habían definido en el proyecto anterior.
- Permitir **crear nuevas categorías y subcategorías**.
- Administrarlas sin perder la información histórica de los gastos asociados.

### 3. Estadísticas y gráficos
- Mostrar totales **por moneda y sin conversión automática**; nunca sumar UYU, USD y EUR.

Mantener el alcance de estadísticas que ya se había definido para la aplicación anterior, enfocado exclusivamente en gastos:

- **Distribución por categoría y subcategoría**.
- **Evolución mensual** de gastos y **comparaciones entre períodos**.
- **Evolución anual** de gastos, tanto general como **por categoría** (por ejemplo, con gráficos de líneas).
- **Filtros** por fechas, categorías y subcategorías.
- **Gráficos interactivos** que muestren importes y permitan explorar los gastos relacionados.

### 4. Presupuestos
- Crear **presupuestos mensuales por categoría y moneda**, calculados solo con gastos de esa moneda.
- Mostrar **límite, monto gastado, importe restante y porcentaje utilizado**.
- Comparar los gastos registrados con el presupuesto correspondiente.

### 5. Historial
- Consultar la lista de gastos.
- **Buscar, filtrar y ordenar** los registros.
- Acceder a las opciones de **edición y eliminación**.

### 6. Acceso privado
- Acceso para **dos cuentas autorizadas**.
- Inicio de sesión mediante **correo electrónico y contraseña**, con mecanismos de seguridad adecuados.
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
| Base de datos | PostgreSQL |
| ORM | Sequelize |
| Despliegue | Vercel |

La base de datos se alojará en un servicio PostgreSQL en la nube, todavía por elegir. La aplicación seguirá una estructura clara y sencilla, inspirada en el proyecto académico `lugares-fullstack`, con responsabilidades separadas (rutas, controladores, servicios, modelos y acceso a datos).

## Decisiones pendientes antes de desarrollar


- Revisar el **catálogo inicial** de categorías y subcategorías.
- Precisar los comportamientos de presupuestos, gráficos y filtros que requieran reglas adicionales.
- Definir el proveedor de PostgreSQL, la implementación de sesiones y el diseño visual.

**Criterio de desarrollo:** empezar por lo esencial, mantener el código comprensible y organizado, probar cada funcionalidad antes de incorporar otra y no añadir complejidad pensando en funciones futuras.
