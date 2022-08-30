docker kill $(docker ps -q  --filter ancestor=webcrawler)
docker build ~/webCrawler -t webcrawler --no-cache
docker run --restart=on-failure -d webcrawler
docker system prune -f
