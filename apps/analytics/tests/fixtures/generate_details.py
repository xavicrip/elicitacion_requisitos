"""Conjunto de validación de la minería de texto (feature 007, T004).

300 detalles Dado/Cuando/Entonces en español sobre 10 actividades, con el formato del archivo de
entrada del contrato (`contracts/analysis-job.md`) y su *ground truth*:

- 3 temas conocidos (pagos, notificaciones, seguridad) y ruido de otros temas;
- 30 pares de casi duplicados (el segundo es una paráfrasis del primero);
- 40 detalles con términos ambiguos del léxico;
- 2 actividades calientes (mucho volumen, votos y comentarios) y 2 frías (sin detalles o con uno);
- detalles con sentimiento negativo;
- la regla `tag:pagos` → `type:non_functional` (la mayoría de los de pagos son no funcionales).

Reproducible (semilla fija): `uv run python tests/fixtures/generate_details.py` reescribe
`details/validation.json`, que se versiona.
"""

import json
import random
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
OUT = HERE / "details" / "validation.json"
SEED = 7
DIAGRAM = "66f100000000000000000001"
PROJECT = "66f000000000000000000001"

ACTIVITIES = [
    ("Seleccionar producto", "noise"),
    ("Agregar al carrito", "noise"),
    ("Iniciar sesión", "seguridad"),
    ("Validar pago", "pagos"),
    ("Emitir factura", "pagos"),
    ("Enviar confirmación", "notificaciones"),
    ("Preparar pedido", "noise"),
    ("Enviar pedido", "notificaciones"),
    ("Gestionar devoluciones", "noise"),  # fría
    ("Auditar accesos", "seguridad"),  # fría
]
HOT = ["Validar pago", "Iniciar sesión"]
COLD = ["Gestionar devoluciones", "Auditar accesos"]

# Cada tema: (contextos, acciones, resultados). Las combinaciones dan intenciones distintas.
TOPICS: dict[str, tuple[list[str], list[str], list[str]]] = {
    "pagos": (
        [
            "el cliente tiene productos en el carrito",
            "el cliente eligió pagar con tarjeta de crédito",
            "el cliente tiene saldo en su monedero electrónico",
            "la pasarela de pagos está disponible",
            "el pedido supera los 500 dólares",
            "el cliente usa una tarjeta de débito extranjera",
            "existe un cupón de descuento vigente",
        ],
        [
            "confirma el pago del pedido",
            "introduce los datos de la tarjeta",
            "solicita pagar en tres cuotas sin intereses",
            "aplica el cupón antes de pagar",
            "reintenta un pago rechazado por el banco",
            "elige transferencia bancaria",
            "cancela el pago antes de autorizarlo",
        ],
        [
            "la pasarela autoriza la transacción en menos de 3 segundos",
            "el cobro se registra con el número de autorización del banco",
            "se cifra el número de tarjeta y nunca se guarda completo",
            "el total cobrado coincide con el total del pedido incluido el IVA",
            "se muestra el motivo del rechazo devuelto por el banco",
            "se emite la factura electrónica con el valor pagado",
            "el reembolso se procesa en un máximo de 5 días hábiles",
        ],
    ),
    "notificaciones": (
        [
            "el cliente registró su correo y su teléfono",
            "el pedido cambió de estado a enviado",
            "el cliente activó las notificaciones push",
            "el repartidor está a menos de 2 kilómetros",
            "el cliente prefiere recibir mensajes por WhatsApp",
            "el pedido lleva 48 horas sin despacharse",
        ],
        [
            "el sistema envía la confirmación del pedido",
            "el cliente consulta el estado de su envío",
            "el cliente desactiva los correos promocionales",
            "se programa el recordatorio de la entrega",
            "el operador reenvía el comprobante",
            "se agrupan las notificaciones del día",
        ],
        [
            "el cliente recibe un correo con el número de seguimiento",
            "llega un SMS con la hora estimada de entrega",
            "la notificación push incluye un enlace al pedido",
            "el mensaje se envía una sola vez aunque haya reintentos",
            "el cliente deja de recibir promociones en menos de 24 horas",
            "el historial de mensajes enviados queda disponible para soporte",
        ],
    ),
    "seguridad": (
        [
            "el usuario tiene una cuenta activa",
            "el usuario falló la contraseña tres veces seguidas",
            "el usuario inicia sesión desde un dispositivo nuevo",
            "un administrador revisa los registros de acceso",
            "la sesión lleva 15 minutos inactiva",
            "el usuario activó la verificación en dos pasos",
        ],
        [
            "el usuario introduce su correo y su contraseña",
            "el sistema detecta un intento de acceso sospechoso",
            "el usuario solicita restablecer la contraseña",
            "el usuario cierra la sesión en todos sus dispositivos",
            "el administrador bloquea una cuenta comprometida",
            "el usuario confirma el código enviado a su teléfono",
        ],
        [
            "la cuenta se bloquea durante 15 minutos",
            "se registra el acceso con la IP y la fecha",
            "se envía un código de verificación de 6 dígitos",
            "la contraseña se guarda con un hash argon2",
            "todas las sesiones abiertas se invalidan",
            "el enlace de restablecimiento caduca en 30 minutos",
        ],
    ),
    "noise": (
        [
            "el catálogo tiene productos de varias categorías",
            "el cliente navega desde un teléfono móvil",
            "el almacén tiene stock del producto",
            "el pedido contiene productos frágiles",
            "el cliente compró antes en la tienda",
            "la tienda tiene una promoción de temporada",
        ],
        [
            "el cliente filtra por precio y por marca",
            "el cliente agrega un producto al carrito",
            "el operario empaca el pedido",
            "el cliente compara dos productos",
            "el cliente guarda un producto en su lista de deseos",
            "el operario imprime la etiqueta de envío",
        ],
        [
            "se muestran solo los productos dentro del rango elegido",
            "el carrito muestra la cantidad y el subtotal actualizados",
            "el paquete lleva la etiqueta con el código de barras",
            "la tabla comparativa muestra las especificaciones lado a lado",
            "el producto aparece en la lista de deseos al volver a entrar",
            "el stock disponible se descuenta al confirmar el pedido",
        ],
    ),
}

AMBIGUOUS = [
    "rápido",
    "fácil",
    "amigable",
    "intuitivo",
    "eficiente",
    "adecuado",
    "etc.",
    "y/o",
    "flexible",
    "mínimo",
]
AMBIGUOUS_THEN = [
    "la respuesta del sistema es {term}",
    "el proceso resulta {term} para el cliente",
    "la pantalla es {term} y clara",
    "el resultado se presenta de forma {term}",
]
NEGATIVE_GIVEN = [
    "hoy el proceso es frustrante y los clientes se quejan de que",
    "es inaceptable y molesto que actualmente",
    "los usuarios odian que en la versión actual",
]
# Paráfrasis: sustituciones que conservan la intención (pares de casi duplicados).
PARAPHRASE = [
    ("el cliente", "el comprador"),
    ("el usuario", "la persona usuaria"),
    ("confirma", "aprueba"),
    ("se envía", "se manda"),
    ("se registra", "queda registrado"),
    ("en menos de", "en un tiempo inferior a"),
    ("el sistema", "la plataforma"),
    ("recibe", "obtiene"),
    ("se muestra", "aparece"),
]
ROLES = ["Cliente", "Cajero", "Operario de almacén", "Soporte", "Repartidor", "Administrador"]
TYPES_BY_TOPIC = {
    "pagos": ["non_functional"] * 8 + ["functional", "business_rule"],
    "notificaciones": ["functional"] * 6 + ["non_functional"] * 3 + ["constraint"],
    "seguridad": ["non_functional"] * 5 + ["functional"] * 3 + ["constraint"] * 2,
    "noise": ["functional"] * 7 + ["business_rule"] * 2 + ["constraint"],
}


def _paraphrase(text: str) -> str:
    out = text
    for source, target in PARAPHRASE:
        if source in out:
            out = out.replace(source, target, 1)
    return out


def generate() -> dict[str, Any]:
    rng = random.Random(SEED)  # noqa: S311 - datos de prueba reproducibles, no criptografía
    keys = {label: f"act-{i + 1:02d}" for i, (label, _) in enumerate(ACTIVITIES)}
    topic_of = dict(ACTIVITIES)
    # Volumen por actividad: calientes con mucho, frías con 0 y 1.
    weights = {label: (4.0 if label in HOT else 1.0) for label, _ in ACTIVITIES}
    weights[COLD[0]] = 0.0
    weights[COLD[1]] = 0.0
    candidates = [label for label, _ in ACTIVITIES if weights[label] > 0]

    details: list[dict[str, Any]] = []
    truth_topic: dict[str, str] = {}
    ambiguous: dict[str, list[str]] = {}
    negative: list[str] = []
    used: set[tuple[str, str, str]] = set()
    start = datetime(2026, 9, 1, 14, 0, tzinfo=UTC)

    def add(
        activity: str, given: str, when: str, then: str, topic: str, *, hot: bool = False
    ) -> dict[str, Any]:
        detail_id = f"66f2{len(details) + 1:020d}"
        tags = [topic] if topic != "noise" else rng.choice([[], ["catálogo"], ["logística"]])
        detail = {
            "id": detail_id,
            "diagramId": DIAGRAM,
            "activityKey": keys[activity],
            "given": given,
            "when": when,
            "then": then,
            "type": rng.choice(TYPES_BY_TOPIC[topic]),
            "priority": rng.choice(["must", "should", "could", "wont", None]),
            "authorRole": rng.choice(ROLES),
            "tags": tags,
            "status": rng.choice(["pending"] * 3 + ["validated"]),
            "voteCount": rng.randint(4, 9) if hot else rng.randint(0, 2),
            "commentCount": rng.randint(2, 6) if hot else rng.randint(0, 1),
            "createdAt": (start + timedelta(hours=7 * len(details)))
            .isoformat()
            .replace("+00:00", "Z"),
        }
        details.append(detail)
        truth_topic[detail_id] = topic
        return detail

    # 1 detalle en una actividad fría (la otra queda sin ninguno).
    given, when, then = (TOPICS["noise"][0][3], TOPICS["noise"][1][2], TOPICS["noise"][2][2])
    add(COLD[0], given, when, then, "noise")
    used.add((given, when, then))

    while len(details) < 240:
        activity = rng.choices(candidates, weights=[weights[c] for c in candidates])[0]
        topic = topic_of[activity] if rng.random() < 0.85 else "noise"
        contexts, actions, results = TOPICS[topic]
        triple = (rng.choice(contexts), rng.choice(actions), rng.choice(results))
        if triple in used:
            continue
        used.add(triple)
        add(activity, *triple, topic, hot=activity in HOT)

    # 40 ambiguos: se sustituye el resultado por una frase con un término del léxico.
    for index, detail in enumerate(rng.sample(details[1:], 40)):
        term = AMBIGUOUS[index % len(AMBIGUOUS)]
        detail["then"] = rng.choice(AMBIGUOUS_THEN).format(term=term)
        ambiguous[detail["id"]] = [term]

    # Sentimiento negativo en 15 detalles (sin tocar los ambiguos).
    plain = [d for d in details[1:] if d["id"] not in ambiguous]
    for detail in rng.sample(plain, 15):
        detail["given"] = f"{rng.choice(NEGATIVE_GIVEN)} {detail['given']}"
        negative.append(detail["id"])

    # 30 pares de casi duplicados: paráfrasis de originales sin ambigüedad ni negatividad.
    pairs: list[list[str]] = []
    originals = [d for d in details[1:] if d["id"] not in ambiguous and d["id"] not in negative]
    for original in rng.sample(originals, 30):
        copy = add(
            next(label for label, key in keys.items() if key == original["activityKey"]),
            _paraphrase(original["given"]),
            _paraphrase(original["when"]),
            _paraphrase(original["then"]),
            truth_topic[original["id"]],
        )
        copy["type"] = original["type"]
        copy["tags"] = list(original["tags"])
        pairs.append([original["id"], copy["id"]])

    # Relleno hasta 300 con más ruido distinto.
    while len(details) < 300:
        activity = rng.choice([c for c in candidates if c not in HOT])
        contexts, actions, results = TOPICS["noise"]
        triple = (rng.choice(contexts), rng.choice(actions), rng.choice(results))
        if triple in used:
            continue
        used.add(triple)
        add(activity, *triple, "noise")

    pagos = [d for d in details if "pagos" in d["tags"]]
    nonfunctional = sum(1 for d in pagos if d["type"] == "non_functional")
    return {
        "input": {
            "v": 1,
            "projectId": PROJECT,
            "filters": {
                "diagramIds": None,
                "from": None,
                "to": None,
                "types": None,
                "statuses": ["pending", "validated"],
            },
            "activities": [
                {"key": keys[label], "diagramId": DIAGRAM, "label": label}
                for label, _ in ACTIVITIES
            ],
            "details": details,
            "duplicateDecisions": [],
        },
        "truth": {
            "topics": truth_topic,
            "duplicatePairs": pairs,
            "ambiguous": ambiguous,
            "negative": negative,
            "hot": [keys[label] for label in HOT],
            "cold": [keys[label] for label in COLD],
            "rules": [
                {
                    "antecedent": "tag:pagos",
                    "consequent": "type:non_functional",
                    "confidence": round(nonfunctional / len(pagos), 3),
                }
            ],
        },
    }


def main() -> None:
    data = generate()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    truth = data["truth"]
    print(
        f"{len(data['input']['details'])} detalles · {len(truth['duplicatePairs'])} pares · "
        f"{len(truth['ambiguous'])} ambiguos · {len(truth['negative'])} negativos · "
        f"regla pagos→no funcional {truth['rules'][0]['confidence']:.0%}"
    )


if __name__ == "__main__":
    main()
