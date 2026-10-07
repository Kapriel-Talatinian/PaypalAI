# DisputeFlow — Spécification Complète du Projet

> **But** : Gagner le PayPal AI Hackathon (2026) en construisant un système neuro-symbolique multi-agents pour la résolution automatique et auditable des litiges PayPal.
>
> **Ce fichier** est la source de vérité unique pour tout développeur ou IA travaillant sur le projet.

---

## 1. Contexte & Objectif

### 1.1 Hackathon
- **Nom** : PayPal AI Hackathon
- **Plateforme** : Devpost
- **Période de soumission** : 1er octobre 2026 (9h PT) → 12 novembre 2026 (12h PT)
- **Jugement** : 1er décembre 2026 → 15 décembre 2026
- **Annonce des gagnants** : ~21 décembre 2026
- **Prix** : Grand Prix (12k$, 8k$, 5k$), Mentions honorables (5k$), Prix sponsors (AG Grid, APIMatic, Bryntum, Channel3, Render)
- **Règles clés** :
  - Intégration centrale de PayPal Developer Platform + IA
  - Projet nouveau ou significativement mis à jour après le 1er octobre 2026
  - Dépôt GitHub public avec licence open source visible
  - Vidéo de démo < 3 min sur YouTube
  - Instructions de setup claires ou URL de démo hébergée
  - Anglais pour tous les matériaux

### 1.2 Problème
Les litiges PayPal (chargebacks, réclamations) sont traités manuellement, lentement, avec des décisions non auditables et une gestion inefficace des exceptions. Les LLM seuls échouent sur le raisonnement non-monotone (une nouvelle preuve peut invalider une conclusion) et hallucinent des règles.

### 1.3 Solution : DisputeFlow
Un système multi-agents hiérarchique qui :
1. Récupère les clauses exactes via une retrieval structurée par Table of Contents (STAIR).
2. Extrait les faits, règles défaisables, defeaters et priorités.
3. Calcule la décision via un solveur ASP (Answer Set Programming) déterministe.
4. Produit un **graphe de preuve** auditable.
5. Exécute la résolution via les API PayPal.
6. Offre un dashboard de contrôle humain (AG Grid + Bryntum).

---

## 2. Architecture Globale

### 2.1 Schéma haut niveau

```mermaid
flowchart TD
    A[Litige PayPal] --> B[STAIR Retrieval]
    B --> C[Extracteur LLM]
    C --> D[Compilation ASP]
    D --> E[Solveur clingo]
    E --> F{Combien de modèles ?}
    F -->|0| G[Self-correction LLM]
    G --> C
    F -->|1| H[Décision unique]
    F -->|N| I[Extensions multiples]
    I --> J[Gouvernance & score de confiance]
    J --> K[Escalade humaine]
    H --> L[Exécution PayPal]
    J --> L
    L --> M[Graphe de preuve + audit]