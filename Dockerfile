FROM node

RUN apt-get update

WORKDIR /home/node/app

COPY . .

RUN npm ci --only=production --omit=dev

CMD [ "npm", "start"]
