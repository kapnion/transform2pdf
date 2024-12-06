FROM node:18-alpine

# Install dependencies required for PhantomJS
RUN apk add --no-cache \
    wget \
    fontconfig \
    freetype \
    libpng \
    libjpeg-turbo \
    bzip2-dev \
    freetype-dev \
    libpng-dev \
    libjpeg-turbo-dev

WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm install --production

# Install PhantomJS globally
RUN npm install -g phantomjs-prebuilt --unsafe-perm

# Bundle app source
COPY . .

EXPOSE 8025

CMD [ "node", "server.js" ]