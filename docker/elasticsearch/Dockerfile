FROM docker.elastic.co/elasticsearch/elasticsearch:8.11.0

USER root
RUN bin/elasticsearch-plugin install --batch \
  https://get.infini.cloud/elasticsearch/analysis-ik/8.11.0 || true

USER elasticsearch
