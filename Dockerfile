FROM node:18.13

WORKDIR /crypto-bot

COPY . .

RUN npm i

CMD node build/main.js