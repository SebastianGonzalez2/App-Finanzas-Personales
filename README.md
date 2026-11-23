# Cifra

Aplicación web personal para **registrar, organizar y analizar gastos**, pensada inicialmente para dos usuarios.

> **Estado:** IMP-03 agrega el historial con búsqueda, filtros, orden y paginación por cursor sobre el registro de IMP-02. Consultá el [informe de IMP-03](docs/imp-03/README.md) y el [de IMP-02](docs/imp-02/README.md).

## Desarrollo

Usá Node.js 24 LTS o Node.js 22 a partir de 22.22. Copiá `.env.example` a `.env.local` y completá la URL y la clave publicable de Supabase de desarrollo. La [guía de IMP-01](docs/imp-01.md) cubre la configuración de Google, la habilitación de las dos plazas y las pruebas con sesiones reales.

```sh
npm ci
npm run dev
npm run lint
npm test
npm run test:db
npm run build
```

La aplicación local se abre en `http://localhost:5173`. El build y las pruebas unitarias y de PostgreSQL embebido también se pueden ejecutar con las variables de Supabase vacías.

**Especificación detallada:** [Requisitos funcionales V1](docs/requisitos-v1.md) (requisitos numerados, criterios de aceptación y decisiones aprobadas).

La [arquitectura técnica aprobada de la V1](docs/arquitectura-v1.md) define el acceso a datos, los permisos y los procedimientos de verificación.

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
- **Evolución anual de gastos por categoría** en un gráfico de líneas interactivo. Comparte moneda y categoría con Estadísticas y tiene su propio selector de años. Muestra cinco años inicialmente, permite navegar a bloques anteriores e identifica el año en curso como parcial.
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
- Tras el alta controlada de ambas identidades se cierran las nuevas altas. En cada operación privada, la Data API valida el token de Supabase Auth y PostgreSQL verifica la plaza, la sesión exacta y la propiedad de los datos mediante RPC y políticas RLS.
- **Información separada** para cada usuario.

## Fuera del alcance de la V1

No implementar por ahora: ingresos, cuentas y saldos bancarios, transferencias, tarjetas de crédito, préstamos, inversiones, fondos y metas de ahorro, compras en cuotas, gastos recurrentes, gestión de gastos compartidos ni otras funciones financieras adicionales.

Podrán evaluarse más adelante, pero **no deben agregarse a la V1 sin una decisión explícita**.

## Arquitectura aprobada para la V1

| Área | Tecnología |
| --- | --- |
| Frontend | React + Vite |
| Acceso a datos | Supabase Data API (PostgREST) y funciones RPC de PostgreSQL |
| Lenguaje | JavaScript |
| Base de datos | PostgreSQL en Supabase |
| Autorización | Comprobación de plaza y sesión en cada RPC, aislamiento por propietario mediante RLS |
| Autenticación | Supabase Auth + Google |
| Despliegue | Vercel |


## Estado de la planificación

Las **cinco decisiones funcionales principales de la V1 están cerradas** y documentadas en [Requisitos funcionales V1](docs/requisitos-v1.md). Las rutas de las funciones financieras están preparadas para sus siguientes etapas.

**Criterio de desarrollo:** empezar por lo esencial, mantener el código comprensible y organizado, probar cada funcionalidad antes de incorporar otra y no añadir complejidad pensando en funciones futuras.
