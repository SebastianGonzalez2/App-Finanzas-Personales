# Pantallas y flujos para implementación

Las rutas y los números RF remiten a la V1 aprobada. Las PNG de la galería definen la composición. Los comportamientos siguientes describen la futura implementación. [Galería](README.md) · [Requisitos V1](../../requisitos-v1.md) · [Arquitectura, §10–11](../../arquitectura-v1.md)

## Resumen · `/` · RF-021, 023, 025 y 027

Leer en este orden: mes y moneda, gasto del mes, seis barras mensuales, tres categorías de mayor importe, presupuesto y gastos recientes. «Nuevo gasto» abre el formulario directamente. «Ver todas» conserva el filtro de moneda y mes en Estadísticas. «Ver límites» abre Presupuestos. «Ver historial» lleva al mes y moneda de los gastos recientes.

El ejemplo muestra 24 gastos en UYU por 28.640. Octubre completo suma 32.000 y la diferencia es −3.360 UYU. La etiqueta «Mes parcial» explica por qué se omite el porcentaje de variación. Para períodos equivalentes cerrados con base positiva mostrar diferencia y porcentaje. Ante base ausente o cero, explicar «Sin base de comparación». Para los seis meses, usar el mes actual y los cinco anteriores, incluso si el año cambia. Indicar «Sin registros» en la posición de un mes vacío.

Ordenar categorías por gasto y mostrar sus participaciones sobre todo el mes. En la muestra, los tres primeros importes suman 26.240 y Servicios aporta los 2.400 restantes. En Presupuestos, destacar el mayor porcentaje utilizado. El exceso de Transporte coincide con la pantalla detallada. Los gastos recientes respetan la moneda de la página. Sin gastos, mantener el CTA de alta. Sin límites, el módulo ofrece «Crear presupuesto».

## Estadísticas · `/estadisticas` · RF-017–023

El selector UYU/USD/EUR es compartido y recordado por usuario en Resumen, Estadísticas y Presupuestos. Esperar la respuesta de la moneda solicitada antes de presentar sus etiquetas con importes. Los filtros de período incluyen mes actual, mes anterior, últimos 3/6/12 meses, año actual y rango personalizado. Exponer las dos fechas para el rango actual y las dos para la referencia. Los filtros de clasificación incluyen categoría, hija y «Sin subcategoría» para desgloses. Cambiar de padre limpia una hija incompatible.

| Panel en el orden aprobado | Lectura y acción |
| --- | --- |
| Indicadores | Total, cantidad y diferencia relativa si corresponde. El importe abre el Historial con los filtros exactos. En el ejemplo UYU 168.000 frente a 150.000 produce +12%. |
| Gastos por mes | Barras verticales en orden temporal, con la tabla equivalente de mes, cantidad e importe. Tocar un mes o usar su enlace de tabla abre la intersección entre el mes y el rango filtrado. En rangos extensos ofrecer bloques anteriores y siguientes según la consulta. |
| Gastos por categoría | Cada barra reúne nombre, cantidad, importe y participación. Elegir «Alimentación» muestra las subcategorías y el grupo «Sin subcategoría». El padre incluye cada gasto una vez. El detalle ofrece «Ver gastos». |
| Comparación por categoría | Categorías presentes en cualquiera de los dos períodos. Mostrar ambos importes, diferencia y porcentaje cuando proceda. Cada columna de importe abre su período. En móvil cada categoría encabeza cuatro valores rotulados. |
| Evolución anual por categoría | Bloque inicial de cinco años hasta el actual. Las flechas contiguas al gráfico navegan por bloques, con el avance deshabilitado en el último. La línea comparte moneda y clasificación con la página. Cambiar el período general conserva el bloque anual. El detalle de punto ofrece el año civil completo y su importe. |
| Resumen del período | Texto derivado de cantidad, total, categoría de mayor gasto y comparación válida. Informar un empate o la falta de base. En el ejemplo, Alimentación suma 75.600 de 168.000 UYU. |

El año 2023 carece de registros en la muestra. El marcador aislado de 2022 y la línea que arranca en 2024 hacen visible el hueco. La marca «2026 parcial» acompaña el bloque y el valor exacto figura en la tabla. Las variaciones anuales se calculan entre años cerrados consecutivos con datos. El foco o toque de un punto informa año, categoría, moneda, importe y estado.

«Todas» presenta los seis paneles. La estrella de cada título alterna su selección, con nombre accesible y estado presionado. «Mis favoritos» conserva el orden, los filtros y el bloque anual. Sin favoritos, mostrar «Todavía no elegiste paneles» y «Ver todas». Un fallo de la consulta anual afecta solo esa tarjeta. Volver desde un desglose restaura el contexto original.

## Historial · `/historial` · RF-007, 008 y 014–016

La primera herramienta es la búsqueda por descripción. El control de fecha y «Filtros» permiten combinar rango, categoría, subcategoría y moneda. Aplicar conserva la búsqueda. «Limpiar» restablece la consulta. La columna Fecha empieza en orden descendente. Fecha e Importe permiten invertir sentido, con flecha y anuncio de orden. En móvil «Fecha ↓» abre las cuatro opciones de orden.

La fila muestra la descripción, la clasificación, la fecha y el importe con código de moneda. Si falta descripción usar el nombre de subcategoría o categoría como título de fila. Mostrar la clasificación histórica aunque esté archivada. Cada fila abre el registro. En escritorio el menú de tres puntos ofrece «Editar» y «Eliminar». En móvil ambas acciones se ofrecen al abrir el detalle. El ejemplo incluye un gasto en USD entre gastos en UYU.

«Cargar más gastos» mantiene filtros, orden y posición. Distinguir «Todavía no registraste gastos» con alta directa de «Sin resultados» con «Limpiar filtros». Un fallo de página permite reintentar sin descartar las filas anteriores.

## Presupuestos · `/presupuestos` · RF-021 y 024–026

Mostrar el mes civil actual. Cada combinación de categoría y moneda admite un límite. El consumo incluye sus subcategorías y los gastos del mes anteriores a la creación del límite. La lectura es categoría, estado, consumo, límite, restante o exceso y porcentaje. Encabeza la lista el mayor porcentaje utilizado. Para un empate, ordenar por nombre.

| Caso de la muestra | Cálculo | Presentación |
| --- | --- | --- |
| Alimentación | 12.800 de 16.000 UYU | 80%, «Dentro del límite», restan 3.200. |
| Vivienda | 9.600 de 10.000 UYU | 96%, ámbar, «Cerca del límite», restan 400. |
| Transporte | 3.840 de 3.600 UYU | 106,67%, rosa, «Superado», exceso de 240. |

Umbral visual propuesto: desde 90% hasta menos de 100%, usar «Cerca del límite». A 100%, mostrar «Límite alcanzado» y restante cero. Por encima del límite, saturar la barra al 100% y conservar el porcentaje real en texto. Con gastos cero y límite existente mostrar 0% y el límite completo como restante.

«Crear límite» abre categoría, moneda y límite mensual positivo. Proponer la moneda activa. Identificar una combinación duplicada y ofrecer editarla. «Editar límite» y «Retirar límite» están en el menú de cada fila. Antes de retirar, identificar categoría y moneda y explicar que los gastos se conservan. Al cambiar de mes se conserva el límite y se recalcula el consumo. Sin límites en esa moneda, mantener visible «Crear límite».

## Nuevo gasto y edición · `/gastos/nuevo`, `/gastos/:id/editar` · RF-004–013

1. Abrir con el importe vacío, moneda preferida y fecha civil de hoy en Montevideo. En la maqueta se muestra un borrador ya completado. En escritorio el foco inicial va al importe. En móvil el primer toque en el importe abre el teclado decimal, para evitar que el teclado oculte el contexto al entrar.
2. Aceptar coma decimal, validar importe mayor que cero y hasta dos decimales. La fecha puede ser anterior. El selector UYU/USD/EUR de este formulario pertenece al gasto. Cambiarlo conserva la preferencia compartida de consulta.
3. Elegir categoría activa y, opcionalmente, subcategoría del mismo padre. Dejar visible la opción «Sin subcategoría». Al pie de cada lista ofrecer «Crear categoría» o «Crear subcategoría». El diálogo secundario pide un nombre, permite cancelar y al confirmar vuelve con el elemento seleccionado y el borrador intacto. Una categoría archivada en un gasto existente se identifica como «Archivada».
4. Agregar descripción opcional. Un único «Guardar gasto» envía el borrador. En la futura UI, ante un error conservar valores y enfocar el primer campo afectado. Ejemplos: «Ingresá un importe mayor que cero» y «Elegí una categoría para este gasto». Al fallar la red, «No pudimos confirmar el guardado» y «Reintentar». Tras confirmación, volver a la vista de origen y actualizar totales, lista y consumo.
5. Editar reutiliza el formulario con el título «Editar gasto» y «Guardar cambios». Si la versión cambió, conservar el borrador e indicar «El gasto cambió desde que lo abriste» con opción para revisar los datos actuales. Al salir con cambios, ofrecer «Seguir editando» y «Descartar cambios». Eliminar abre confirmación con descripción, importe, moneda y fecha, y regresa al Historial tras éxito.

La ruta diaria consta de importe, moneda, fecha y categoría. Subcategoría y descripción son opcionales. Las compras en cuotas están excluidas en la V1, por lo que la propuesta no reserva campos ni variantes para ellas. [Exclusiones funcionales](../../requisitos-v1.md#4-exclusiones-expresas-de-la-v1)

## Login, categorías y cuenta · RF-001–003 y 010–013

| Superficie | Especificación |
| --- | --- |
| `/login` | La acción «Continuar con Google» ocupa todo el ancho del bloque. Recuperación de acceso enlaza a Google. En móvil la ilustración ocupa la franja superior y el botón cabe en el primer viewport de 375 × 812. |
| `/auth/callback` | Reutilizar el bloque de acceso con «Verificando tu sesión…». Tras validar sesión y plaza se abre Resumen. Si el código caducó, mostrar «El enlace de acceso venció» y «Volver a ingresar». Una identidad sin plaza ve «Esta cuenta no tiene acceso» y una acción para salir y elegir otra cuenta. |
| `/categorias` | Desde Organización, mostrar «Activas / Archivadas» y el árbol de dos niveles del catálogo de 13 categorías. Abrir un padre despliega hijas y «Crear subcategoría». Editar en panel lateral o en hoja móvil. Las acciones son crear, renombrar, archivar y restaurar. Ante un nombre duplicado archivado, ofrecer restaurar. Archivar un padre conserva el histórico e impide elegir sus hijas en un alta. |
| Mi cuenta | Al pie del lateral o dentro del menú móvil. Mostrar la identidad de la sesión y «Cerrar sesión». Indicar salida en curso y reintento cuando corresponda. Al expirar o cerrar sesión salir de las vistas privadas. |

## Comprobaciones para la revisión

- Abrir las seis láminas a 1440, 834 y 375 px. El visor utiliza ejemplos locales. Verificar que cada importe mantenga su moneda visible y que las cifras largas o las clasificaciones extensas envuelvan la fila antes de ocultar datos esenciales.
- Comparar Transporte en Resumen y Presupuestos. La barra llena, el texto «Superado» y el exceso de 240 UYU deben comunicar el mismo estado con o sin color.
- Abrir el menú móvil y localizar Categorías y Mi cuenta. Desde la cabecera cerrada, «Nuevo gasto» llega al formulario en un toque. El expansor del lateral de escritorio conserva el destino activo.
- Leer 2022, 2023 y 2026 en la tabla anual. Deben distinguirse un valor conocido, un año sin registros y un año parcial. Confirmar que el detalle tabular siga disponible a 375 px.
- Durante la implementación, comprobar con teclado y teléfono físico el foco, el retorno de diálogos, la lectura anunciada de errores y el guardado con respuesta de red incierta.
