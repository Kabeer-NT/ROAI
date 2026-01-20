FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Expose Astro's default port
EXPOSE 4321

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]