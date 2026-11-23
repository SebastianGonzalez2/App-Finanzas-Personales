# Sistema visual

## Lectura de las tres referencias

| Imagen | Evidencia visual | Aplicación a gastos |
| --- | --- | --- |
| [01 · Navegación](../../references/ui/dashboard-style/reference-01.png) | Lateral oscuro abierto, grupos separados por líneas, iconos de trazo y selección con borde e iluminación interior. Un número grande se lee antes que su metadato monoespaciado. | Dos grupos de navegación y cuenta al pie. Selección en grafito con texto claro. El gasto mensual tiene mayor escala que el identificador UYU y el conteo. |
| [02 · Series y tabla](../../references/ui/dashboard-style/reference-02.png) | Las barras se construyen con celdas discretas. La retícula tiene poco contraste. El tooltip ofrece detalle exacto. Las filas comparten alineaciones entre etiquetas, importes y estados. | Seis barras de microsegmentos, meses consecutivos y una unidad explícita. Para leer un valor exacto se usa el detalle por foco o toque y la tabla equivalente. La lista de gastos conserva los códigos de moneda. |
| [03 · Progreso y acciones](../../references/ui/dashboard-style/reference-03.png) | Arco con marcas radiales, cifra central, barras segmentadas y botones de acción marfil. Una trama diagonal localizada aporta profundidad. | El arco muestra el porcentaje de un límite mensual real. La escala gráfica termina en 100% y el centro conserva 106,67% en el ejemplo excedido. El texto adyacente cuantifica el exceso. La trama se concentra en la tarjeta de importe y en el acceso. |

El paisaje que rodea las tres capturas enmarca el producto en la referencia. En una pantalla de trabajo a 375 px ese espacio se destina al importe, los controles y el detalle. El contenido diario queda sobre fondos estables. El grabado estático y el brillo interior de los botones aportan profundidad sin movimiento. Los tamaños de texto y las áreas táctiles aumentan respecto de las referencias para poder registrar un gasto con una mano.

## Tokens y superficies

Valores de partida para el frontend. Los nombres coinciden con la hoja de estilo de las láminas. Los contrastes indicados se calcularon contra la superficie de panel. [Hoja de estilo](vistas/estilo.css)

| Uso | Token | Valor | Aplicación |
| --- | --- | --- | --- |
| Lienzo, lateral | `--fondo`, `--lateral` | #101112, #0c0d0e | Lienzo estable y lateral persistente. |
| Tarjeta, superficie elevada | `--panel`, `--alto` | #171819, #222426 | Panel de datos, icono, selector y diálogo. |
| Separador, borde de control | `--linea`, `--control` | #353739, #727679 | Líneas de 1 px. El borde de campo alcanza 3,9:1 sobre panel. |
| Texto principal | `--texto` | #f4f2eb | Cifras, títulos y cuerpo de mayor énfasis. 15,9:1. |
| Texto secundario, metadato | `--suave`, `--muted` | #b9babb, #a0a3a4 | Etiquetas, fechas y unidades. 9,1:1 y 7,0:1. |
| Confirmación y foco | `--salvia` | #adcfba | Mensaje confirmado y contorno de foco, 10,5:1. |
| Cercanía al límite | `--ambar` | #e3bd84 | Texto «Cerca del límite» y progreso, 10,1:1. |
| Exceso o error | `--rosa` | #e5a6a3 | Mensaje explícito junto al importe o campo, 8,7:1. |

Panel ordinario opaco con radio de 12 px. Campo, botón y tarjeta de icono de 8 px. Chips de 5 px. El fondo de la cabecera móvil fija tiene una opacidad del 97%. El velo de diálogo usa negro al 60% y la superficie elevada permanece opaca para mantener legibles las etiquetas. Ningún componente requiere desenfoque de pantalla completa.

## Tipografía y composición

| Nivel | Escritorio | Móvil | Tratamiento |
| --- | --- | --- | --- |
| Título de página | 38–50 px según ancho | 34 px | Inter con fallback Segoe UI y Arial. Peso intermedio 550, interlínea 1,1. |
| Importe del mes | 46–76 px | 56 px | Peso 510, cifras tabulares, unidad de 14 px sobre la línea base. |
| Importe editable | 56 px | 48 px | Foco en el número. Moneda en selector asociado. |
| Título de panel | 19 px | 19 px | Peso 570, interlínea 1,25. |
| Texto corriente | 15 px | 15 px | Interlínea 1,45. Labels de campo y metadatos de 13–14 px. |
| Ejes, unidades, fechas y estados | 11–14 px | 11–14 px | Cascadia Mono, Consolas, monospace. Usar mayúsculas espaciadas solo en rótulos cortos. |

La base de espaciado es 8 px. La página usa 48, 32, 24 o 16 px según ancho. Los paneles se separan 16 px en escritorio y 12 px en móvil. Los pasos de 4 px se reservan para relaciones internas como valor–unidad, icono–etiqueta y bordes de controles segmentados. Alinear importes a la derecha en tablas y sobre una misma línea base en indicadores. Usar punto de miles y coma decimal. Conservar los centésimos significativos en los totales y mostrar dos decimales en las filas editables.

## Componentes y estados de interacción

| Componente | Apariencia y respuesta prevista |
| --- | --- |
| Acción principal | Marfil #f5f3ec → #d8d7d0 con texto #171819. Al pasar el puntero se aclara el extremo inferior. Al presionar se invierte el relieve interior. Un CTA por tarea. En Nuevo gasto, la acción principal pasa a «Guardar gasto». |
| Secundaria y destructiva | Superficie grafito, contorno fino y verbo explícito. En la confirmación de borrado, «Eliminar gasto» usa texto rosa, «Cancelar» conserva el foco inicial. |
| Foco e inactivo | Contorno salvia de 2 px separado 3 px. Estado inactivo con contraste reducido, semántica deshabilitada y motivo próximo cuando se necesita contexto. El foco recorre la página en orden de lectura. |
| Selectores y campos | Label persistente encima. Altura mínima 44 px. El desplegable indica selección con marca. Texto auxiliar asociado al campo. Error con borde rosa, mensaje específico y foco en el primer campo inválido. |
| Tarjeta y tabla | Título y acción en los extremos de una línea. Cabeceras discretas, separadores horizontales, moneda junto al número. En móvil cada fila reúne descripción, fecha y clasificación junto al importe. Tocar la fila abre el registro. |
| Tooltip y tabla de gráfico | Superficie elevada, fecha o período, clasificación, moneda e importe exacto. Foco, puntero y toque revelan el mismo dato. Seleccionar «Ver gastos» abre el Historial con esos filtros. Escape o tocar fuera cierra. La tabla equivalente se presenta desplegada inicialmente en móvil. |
| Modal | Ancho máximo de 440 px y padding de 24 px. Título, consecuencia o campo y acciones al pie. En móvil, hoja a ancho disponible con 16 px de margen y scroll interno si aparece el teclado. Bloquear el fondo, contener el foco, cerrar con Escape y devolver el foco al control de origen. |
| Espera y reintento | Reservar la altura del panel con bloques estáticos y texto «Cargando gastos…». Al actualizar la misma consulta, conservar contexto y marcar «Actualizando». Cambiar moneda o propietario oculta las cifras anteriores de inmediato. Error local con explicación y «Reintentar». |
| Feedback | «Guardando…» bloquea un segundo envío. «Gasto guardado» se anuncia tras confirmación del servidor. Ante error mantener importes, clasificación y descripción e identificar la acción recuperable. |

## Navegación y adaptación

| Ancho CSS | Navegación y composición |
| --- | --- |
| Desde 1181 px | Barra lateral de 224 px abierta o 72 px compacta. Cabecera de 72 px. Resumen en dos columnas y gastos recientes a todo el ancho. Presupuestos presenta una tabla al lado del límite destacado. |
| 861–1180 px | Barra abierta de 184 px o compacta de 72 px. Márgenes de 24 px. Reducir padding de tarjetas antes de reducir texto. Presupuestos pasa a filas con valores rotulados. |
| 621–860 px | Iconos en carril de 72 px por defecto. Resumen conserva dos columnas. Estadísticas y Presupuestos se apilan. En la implementación, el expansor muestra los nombres sobre el contenido con cierre explícito. |
| Hasta 620 px | Cabecera fija de 64 px con menú y «Nuevo gasto». Márgenes de 16 px, una columna, filtros plegables y fechas bajo la descripción. El menú abierto agrupa las cuatro secciones, Categorías y Mi cuenta. En Nuevo gasto se reserva la cabecera para navegación y la acción al pie para guardar. |

La sección activa combina texto claro, borde, superficie y `aria-current="page"`. El carril compacto mantiene el orden y ofrece nombre accesible y etiqueta por foco o puntero. La transición prevista de anchura es de 140 ms, con cambio inmediato al solicitar movimiento reducido. En móvil, reservar al menos 44 × 44 px de área accionable para iconos, selectores, favoritos y opciones de fila. Con el menú cerrado, abrir el registro requiere un toque. Completar y guardar depende de los campos ingresados.
