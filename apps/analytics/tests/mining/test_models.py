"""Los modelos de la minería cargan y responden (feature 007, T017)."""

import spacy
from sentence_transformers import SentenceTransformer

EMBEDDINGS = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


def test_spacy_lematiza_en_espanol() -> None:
    nlp = spacy.load("es_core_news_md")
    assert [token.lemma_ for token in nlp("Los usuarios validaron los pagos")] == [
        "el",
        "usuario",
        "validar",
        "el",
        "pago",
    ]


def test_los_embeddings_acercan_las_parafrasis() -> None:
    model = SentenceTransformer(EMBEDDINGS)
    a, b, c = model.encode(
        [
            "el cliente confirma el pago del pedido",
            "el comprador aprueba el pago del pedido",
            "el operario imprime la etiqueta de envío",
        ],
        normalize_embeddings=True,
    )
    assert float(a @ b) > float(a @ c) + 0.2
