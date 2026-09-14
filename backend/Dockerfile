# Contexte de build : la racine du dépôt (voir deploy/docker-compose.yml).
# Le site (index.html, gestion.html, img/, fonts/…) et le backend voyagent
# dans la même image : c'est backend/src/server.js qui sert les deux, sur la
# même origine — voir server.js pour le pourquoi (pas de CORS, pas de second
# nom de domaine à tenir à jour).
FROM node:20-alpine
WORKDIR /app/backend
COPY backend/package*.json ./
# npm ci exigerait un package-lock.json, absent ici (il est dans .gitignore
# à la racine du dépôt) — npm install s'en passe, sans problème pour les
# trois dépendances de ce backend.
RUN npm install --omit=dev
COPY . /app
# HOST=0.0.0.0 est obligatoire ici : dans un conteneur, le reverse proxy
# arrive par le réseau Docker, pas par 127.0.0.1. Hors conteneur, le serveur
# n'écoute que sur 127.0.0.1 (voir src/server.js). PORT reste modifiable
# depuis .env ; EXPOSE n'est qu'une déclaration, il n'ouvre rien.
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
EXPOSE 8787
CMD ["node", "src/server.js"]
