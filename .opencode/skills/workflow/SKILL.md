---
name: workflow
description: Use when the user says "has commit", "haz commit", "push", "commit de esto", or asks to commit/push changes. Defines the project's git workflow shortcuts.
---

# Workflow

Atajos para tareas repetitivas del proyecto.

## "has commit"

Cuando el usuario diga **"has commit"** (o "haz commit"), seguir estos pasos:

1. `git add .` — incluir todos los cambios pendientes sin filtrar.
2. `git commit -m "mensaje"` — mensaje corto, descriptivo, que referencie lo que se hizo. Si GPG falla, usar `--no-gpg-sign`.
3. Antes del push, preguntar: **"me das viso bueno para hacer push?"**.
4. Solo hacer `git push` si el usuario confirma explícitamente.
