# Feature Specification: Dashboard analítico con minería de datos y de texto

**Feature Branch**: `007-dashboard-analitico`
**Created**: 2026-09-25
**Status**: Draft
**Input**: User description: "El administrador revisa un dashboard que procesa los detalles de las actividades con técnicas de minería de datos y de texto en español (métricas descriptivas, palabras clave, temas, agrupación de requisitos similares, duplicados, sentimiento, calidad del requisito, reglas de asociación) y genera hallazgos e insights en lenguaje natural (prompt.md RF-07, Fase 6)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visión general del levantamiento (Priority: P1)

El Administrador abre el dashboard de su proyecto y ve de un vistazo: número total de
detalles, participantes activos, porcentaje de actividades cubiertas, distribución por
actividad, tipo, prioridad y rol, evolución de los aportes en el tiempo y un mapa de calor
de cobertura sobre el propio diagrama.

**Why this priority**: responde a la pregunta básica "¿cómo va el levantamiento?" y no
depende de técnicas avanzadas.

**Independent Test**: con un proyecto de datos de ejemplo (10 actividades, 80 detalles,
6 participantes), comprobar que cada indicador coincide con el cálculo manual.

**Acceptance Scenarios**:

1. **Given** un proyecto con detalles, **When** el Administrador abre el dashboard, **Then** ve los
   indicadores clave, los gráficos de distribución y la serie temporal de aportes.
2. **Given** el dashboard, **When** filtra por diagrama, rango de fechas, tipo o estado, **Then**
   todos los indicadores y gráficos se recalculan con el filtro.
3. **Given** el mapa de calor de cobertura, **When** hace clic en una actividad, **Then** ve el
   detalle de sus indicadores y un acceso a sus requisitos.
4. **Given** un Participante, **When** intenta abrir el dashboard, **Then** el acceso se deniega.

---

### User Story 2 - Análisis del texto de los requisitos (Priority: P1)

El Administrador ejecuta el análisis de texto. El sistema procesa los detalles en español y
muestra: palabras y frases clave por actividad, nube de palabras, red de términos que
aparecen juntos, **temas** transversales descubiertos automáticamente y **grupos** de
requisitos semánticamente similares.

**Why this priority**: es la capacidad diferencial de "minería de texto" que pide el proyecto.

**Independent Test**: con el conjunto de ejemplo, que contiene 3 temas conocidos (pagos,
notificaciones, seguridad), comprobar que el análisis los identifica como temas distintos.

**Acceptance Scenarios**:

1. **Given** un proyecto con al menos 20 detalles, **When** el Administrador ejecuta el análisis,
   **Then** este se procesa en segundo plano con indicador de progreso y el resultado queda
   guardado con su fecha.
2. **Given** un análisis completado, **When** consulto las palabras clave de una actividad,
   **Then** veo los términos más distintivos de esa actividad frente a las demás.
3. **Given** un análisis completado, **When** consulto los temas, **Then** veo cada tema con sus
   términos representativos, el número de detalles y las actividades donde aparece.
4. **Given** un grupo de requisitos similares, **When** lo abro, **Then** veo sus detalles y puedo
   ir a cada uno.
5. **Given** un proyecto con menos de 20 detalles, **When** intento ejecutar el análisis de temas,
   **Then** el sistema indica que no hay datos suficientes y muestra solo el análisis
   descriptivo.

---

### User Story 3 - Calidad y duplicados (Priority: P2)

El dashboard señala los requisitos con problemas de calidad: términos ambiguos ("rápido",
"fácil", "amigable", "etc."), escenarios vagos o incompletos, y los pares de detalles
**casi duplicados**. Cada detalle tiene un puntaje de calidad con su explicación, y el
Administrador puede ir directamente a corregirlo o a marcarlo como duplicado.

**Why this priority**: convierte el análisis en acciones concretas de mejora de los
requisitos.

**Independent Test**: incluir en los datos 5 detalles con términos ambiguos y 3 pares de
duplicados; verificar que se detectan al menos 4 y 2, respectivamente.

**Acceptance Scenarios**:

1. **Given** un detalle con "El sistema debe responder rápido", **When** se analiza, **Then** se
   marca el término ambiguo "rápido" y se sugiere hacerlo medible.
2. **Given** dos detalles con la misma intención redactada de forma distinta, **When** se analiza,
   **Then** aparecen como posible duplicado, con un porcentaje de similitud.
3. **Given** un posible duplicado, **When** el Administrador lo confirma, **Then** el detalle se
   marca como *duplicado* del otro (feature 004); **When** lo rechaza, **Then** el par no vuelve
   a proponerse.
4. **Given** la lista de calidad, **When** la ordeno por puntaje, **Then** veo primero los
   detalles de menor calidad.

---

### User Story 4 - Patrones, sentimiento y actividades críticas (Priority: P2)

El dashboard muestra el sentimiento de los aportes (dolores o frustraciones expresados),
las **reglas de asociación** entre etiquetas, tipos y actividades (p. ej., "cuando la
etiqueta es *pagos*, el 70 % de los requisitos son No funcionales") y clasifica las
actividades como "calientes" (mucho volumen, votos o desacuerdo) o "frías" (sin cobertura
o con muy poca).

**Why this priority**: ayuda a priorizar dónde profundizar en la siguiente sesión.

**Independent Test**: con los datos de ejemplo, verificar que se identifican como "calientes"
y "frías" las actividades preparadas para ello.

**Acceptance Scenarios**:

1. **Given** un análisis completado, **When** consulto el sentimiento, **Then** veo la
   distribución positivo/neutro/negativo por actividad y los detalles más negativos.
2. **Given** un análisis completado, **When** consulto las reglas de asociación, **Then** veo cada
   regla con su soporte y su confianza, explicada en lenguaje natural.
3. **Given** un análisis completado, **When** consulto las actividades críticas, **Then** veo las
   calientes y las frías, cada una con el motivo de su clasificación.

---

### User Story 5 - Insights en lenguaje natural (Priority: P3)

El sistema genera un resumen de los hallazgos principales y recomendaciones concretas en
español, redactados a partir de los resultados del análisis. Cada afirmación indica los
datos en los que se basa y enlaza a ellos. El Administrador puede regenerar el resumen o
marcar un insight como no útil.

**Why this priority**: facilita comunicar los hallazgos, pero depende de todos los análisis
anteriores.

**Independent Test**: generar el resumen con el conjunto de ejemplo y comprobar que cada
insight enlaza a datos del dashboard que lo sustentan.

**Acceptance Scenarios**:

1. **Given** un análisis completado, **When** el Administrador pide el resumen, **Then** recibe
   entre 3 y 10 hallazgos y recomendaciones en español.
2. **Given** un insight como "La actividad *Validar pago* concentra el 30 % de los requisitos no
   funcionales", **When** hago clic en él, **Then** veo los datos que lo sustentan.
3. **Given** un insight, **When** lo marco como "no útil", **Then** se registra para mejorar
   futuros resúmenes y se oculta.
4. **Given** que el servicio de generación de texto no está disponible, **When** pido el resumen,
   **Then** el resto del dashboard sigue funcionando y se me indica que el resumen no está
   disponible.

---

### Edge Cases

- Detalles escritos en otro idioma o con muchas faltas de ortografía: se analizan igualmente;
  la calidad del resultado puede bajar y se indica el porcentaje de texto no reconocido.
- Se agregan detalles después del análisis: el dashboard indica que el análisis está
  desactualizado y cuántos detalles nuevos hay.
- Se ejecuta un análisis mientras otro está en curso: no se lanza un segundo; se informa del
  que está en proceso.
- Proyectos muy grandes (5 000 detalles): el análisis termina en un tiempo razonable y no
  afecta a quienes están aportando requisitos.
- Los detalles *descartados* se excluyen por defecto del análisis; los *duplicados* se cuentan
  una sola vez.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Solo los Administradores del proyecto DEBEN poder acceder al dashboard.
- **FR-002**: El dashboard DEBE mostrar: total de detalles, participantes activos, % de
  actividades cubiertas, distribuciones por actividad/tipo/prioridad/rol/estado, serie
  temporal de aportes y mapa de calor de cobertura sobre el diagrama.
- **FR-003**: Todos los indicadores DEBEN poder filtrarse por diagrama, rango de fechas, tipo
  y estado.
- **FR-004**: El análisis de texto DEBE preprocesar el español (normalización, eliminación de
  palabras vacías y reducción a la forma base de las palabras).
- **FR-005**: El sistema DEBE calcular palabras y frases clave por actividad, nube de palabras y
  red de coocurrencia de términos.
- **FR-006**: El sistema DEBE descubrir temas transversales y agrupar los detalles
  semánticamente similares.
- **FR-007**: El sistema DEBE detectar pares de detalles casi duplicados con un porcentaje de
  similitud, y permitir confirmarlos o rechazarlos.
- **FR-008**: El sistema DEBE calcular el sentimiento de cada detalle y su distribución por
  actividad.
- **FR-009**: El sistema DEBE calcular un puntaje de calidad por detalle, detectando términos
  ambiguos de una lista configurable y escenarios incompletos o vagos, con una explicación.
- **FR-010**: El sistema DEBE calcular reglas de asociación entre etiquetas, tipos, prioridades
  y actividades, con soporte y confianza.
- **FR-011**: El sistema DEBE clasificar las actividades como calientes o frías, indicando el
  motivo.
- **FR-012**: El sistema DEBE generar un resumen de hallazgos y recomendaciones en español, en
  el que cada afirmación referencie los datos que la sustentan.
- **FR-013**: Los análisis DEBEN ejecutarse en segundo plano, bajo demanda o de forma
  programada (configurable, p. ej., cada noche), y guardar sus resultados con fecha para
  consultarlos sin recalcular.
- **FR-014**: El dashboard DEBE indicar si el análisis está desactualizado respecto a los datos
  actuales.
- **FR-015**: Ningún resultado del análisis DEBE modificar los detalles sin la confirmación del
  Administrador.

### Key Entities

- **Ejecución de análisis**: cálculo sobre los detalles de un proyecto en un momento dado
  (estado, filtros, fechas, número de detalles analizados).
- **Resultado de análisis**: indicadores, palabras clave, temas, grupos, duplicados,
  sentimiento, calidad, reglas y clasificación de actividades de una ejecución.
- **Tema**: conjunto de términos representativos y de detalles asociados.
- **Par de posibles duplicados**: dos detalles, su similitud y la decisión del Administrador.
- **Insight**: afirmación o recomendación en lenguaje natural, con referencias a los datos y
  la valoración del Administrador.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El dashboard descriptivo se carga en menos de 3 segundos para proyectos de hasta
  2 000 detalles.
- **SC-002**: El análisis completo de 2 000 detalles termina en menos de 5 minutos.
- **SC-003**: En el conjunto de validación, al menos el 80 % de los pares duplicados preparados
  se detecta, con menos del 20 % de falsos positivos.
- **SC-004**: Al menos el 80 % de los términos ambiguos preparados en el conjunto de validación
  se señala.
- **SC-005**: En la evaluación con analistas, al menos el 70 % de los insights generados se
  valora como útil.
- **SC-006**: El 100 % de los insights enlaza a los datos que lo sustentan.

## Assumptions

- Depende de las features 003 y 004; los análisis de texto requieren un mínimo de 20 detalles.
- El idioma principal de los detalles es el español.
- La generación de insights usa un modelo de lenguaje externo; su proveedor y su coste se
  deciden en el plan. Solo se le envían los resultados agregados y los textos de los detalles
  del proyecto, nunca datos personales de los usuarios.
- Se preparará un conjunto de datos de validación etiquetado (duplicados, ambigüedades y temas
  conocidos) para medir los criterios de éxito.
