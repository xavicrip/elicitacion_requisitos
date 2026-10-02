"""Registro de las técnicas del análisis en `analytics.mining.run.TECHNIQUES`.

Cada historia de la feature 007 añade aquí el import de su módulo; importar este archivo carga
las dependencias del grupo `mining`, así que solo lo hace el worker (`default_processor`).
"""

from analytics.mining import clusters, cooccurrence, keywords, topics

__all__ = ["clusters", "cooccurrence", "keywords", "topics"]
