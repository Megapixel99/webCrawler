function getMeta(doc) {
    let obj = {};
    let metas = doc.getElementsByTagName('meta');
    for (let i = 0; i < metas.length; i++) {
        obj[(metas[i].getAttribute('name') || metas[i].getAttribute('property'))] = metas[i].getAttribute('content');
    }
    let links = doc.getElementsByTagName('link');
    for (let i = 0; i < links.length; i++) {
        if (links[i].getAttribute('rel') === "canonical") {
            obj["link"] = links[i].getAttribute('href');
            break;
        }
    }
    return obj;
}

module.exports = getMeta;
