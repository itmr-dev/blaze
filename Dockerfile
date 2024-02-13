FROM node:20-alpine

WORKDIR /usr/src/app

COPY ./package*.json ./
COPY yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

COPY . .

EXPOSE $PORT

CMD ["yarn", "start"]