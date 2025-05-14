let rasterLayer = null;
let streetsLayer = null;
let georaster = null;

let graph = {}; // Aquí se guardará el grafo de calles
let itpLatLng = L.latLng(20.0836858, -98.7746272); // Coordenadas fijas del ITP


const map = L.map('map').setView([20.0836858, -98.7746272], 17.5);

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri & sources',
    maxZoom: 20
}).addTo(map);

const palette = [
    '#67001f', '#8c0c25', '#b2182b', '#c43c3c', '#d6604d',
    '#e58268', '#f4a582', '#f7b799', '#fac9b0', '#fddbc7',
    '#e7e0dc', '#d1e5f0', '#b2d5e7', '#92c5de', '#6aacd0',
    '#4393c3', '#327cb8', '#2166ac', '#134b86', '#053061'
];

const getColor = v => palette[Math.min(19, Math.floor(Math.max(0, Math.min(100, v)) / 5))];

function getLevelInfo(score) {
    if (score >= 80) return { text: 'Perfecto', class: 'level-perfecto' };
    if (score >= 60) return { text: 'Bueno', class: 'level-bueno' };
    if (score >= 40) return { text: 'Aceptable', class: 'level-aceptable' };
    if (score >= 20) return { text: 'Malo', class: 'level-malo' };
    return { text: 'Pésimo', class: 'level-pesimo' };
}

function updateAccessibilityPanel(latlng) {
    const score = getRasterScore(latlng);
    const levelInfo = getLevelInfo(score);

    const scoreDisplay = document.getElementById('score-display');
    const levelDisplay = document.getElementById('level-display');

    scoreDisplay.textContent = score;
    levelDisplay.textContent = levelInfo.text;

    levelDisplay.className = ''; // Quitar clases anteriores
    levelDisplay.classList.add(levelInfo.class);
}


function getRasterScore(latlng) {
    const x = Math.floor((latlng.lng - georaster.xmin) / georaster.pixelWidth);
    const y = Math.floor((georaster.ymax - latlng.lat) / Math.abs(georaster.pixelHeight));

    if (x < 0 || x >= georaster.width || y < 0 || y >= georaster.height) return 0;

    const raw = georaster.values[0][y][x];
    return (raw === undefined || isNaN(raw)) ? 0 : Math.round(raw);
}

async function loadGeoTIFF(url) {
    try {
        georaster = await parseGeoraster(await (await fetch(url)).arrayBuffer());
        rasterLayer = new GeoRasterLayer({
            georaster,
            opacity: 1,
            resolution: 64,
            pixelValuesToColorFn: values => getColor(values[0])
        }).addTo(map);

        const bounds = rasterLayer.getBounds();
        map.setMaxBounds(bounds);
        map.on('drag', () => map.panInsideBounds(bounds, { animate: false }));
        map.setMinZoom(16.5);
        map.setMaxZoom(19);
        setupOpacityControl();

        map.on('click', function (e) {
            updateAccessibilityPanel(e.latlng);

        });


    } catch (err) {
        console.error('Error al cargar GeoTIFF:', err);
    }
}

function setupOpacityControl() {
    const slider = document.getElementById('opacity-slider');
    const valueDisplay = document.getElementById('opacity-value');

    slider.addEventListener('input', function () {
        const opacity = parseFloat(this.value);
        rasterLayer.setOpacity(opacity);
        valueDisplay.textContent = `${Math.round(opacity * 100)}%`;
    });
}

async function loadShapefilePoint() {
    try {
        const data = await shp('assets/ITP.zip');
        const schoolIcon = L.icon({
            iconUrl: 'assets/ITP.png',
            iconSize: [180, 132],
            iconAnchor: [90, 132],
            popupAnchor: [0, -140]
        });

        L.geoJSON(data, {
            pointToLayer: function (feature, latlng) {
                return L.marker(latlng, {
                    icon: schoolIcon
                }).bindPopup(`<b>${feature.properties.name || 'Instituto Tecnológico de Pachuca'}</b>`);
            }
        }).addTo(map);

    } catch (err) {
        console.error('Error al cargar shapefile:', err);
    }
}



function onEachStreetFeature(feature, layer) {
    if (feature.properties) {
        const props = feature.properties;
        const content = `
            <div class="street-popup">
                <h3>${props.NOMVIAL || 'Sin nombre'}</h3>
                <table>
                    <tr><th>Tipo de vía:</th><td>${props.TIPOVIAL || 'No especificado'}</td></tr>
                    <tr><th>Sentido:</th><td>${props.SENTIDO === 'DOS' ? 'Doble sentido' : 'Un solo sentido'}</td></tr>
                </table>
            </div>
        `;
        layer.bindPopup(content);

        layer.on('click', function (e) {
            updateAccessibilityPanel(e.latlng);

        });
    }
}

async function loadStreets() {
    try {
        const data = await shp('assets/Vialidades.zip');

        streetsLayer = L.geoJSON(data, {
            style: function (feature) {
                let color = '#3498db';
                let weight = 5;
                let dashArray = null;

                if (feature.properties.TIPOVIAL) {
                    const tipo = feature.properties.TIPOVIAL.toLowerCase();
                    switch (tipo) {
                        case 'avenida':
                            color = '#e74c3c'; weight = 7; break;
                        case 'boulevard':
                            color = '#2ecc71'; weight = 8; break;
                        case 'retorno':
                            color = '#f39c12'; weight = 5; dashArray = '10, 5'; break;
                        case 'calle':
                            color = '#3498db'; weight = 5; break;
                        case 'privada':
                            color = '#9b59b6'; weight = 4; dashArray = '5, 5'; break;
                        case 'cerrada':
                            color = '#34495e'; weight = 4; break;
                        case 'callejón':
                            color = '#95a5a6'; weight = 6; break;
                        case 'andador':
                            color = '#1abc9c'; weight = 7; dashArray = '5, 3'; break;
                    }
                }

                return {
                    color,
                    weight,
                    opacity: 0.8,
                    fillOpacity: 0.8,
                    dashArray,
                    lineJoin: 'round'
                };
            },
            onEachFeature: onEachStreetFeature
        }).addTo(map);

        setupLayerControl();

        // Crear el grafo a partir de las calles
        data.features.forEach(feature => {
            if (feature.geometry.type === "LineString") {
                const coords = feature.geometry.coordinates;

                for (let i = 0; i < coords.length - 1; i++) {
                    const from = coords[i];
                    const to = coords[i + 1];

                    const fromKey = `${from[1].toFixed(6)},${from[0].toFixed(6)}`; // lat,lng
                    const toKey = `${to[1].toFixed(6)},${to[0].toFixed(6)}`; // lat,lng

                    const distance = map.distance([from[1], from[0]], [to[1], to[0]]); // en metros

                    if (!graph[fromKey]) graph[fromKey] = [];
                    if (!graph[toKey]) graph[toKey] = [];
                    
                    graph[fromKey].push({ node: toKey, distance });
                    graph[toKey].push({ node: fromKey, distance }); // Bidireccional
                    
                }
            }
        });

    } catch (err) {
        console.error('Error al cargar vialidades:', err);
    }
}

map.on('click', function(e) {
    const startLatLng = e.latlng;
    const startNode = findNearestNode(startLatLng);
    const endNode = findNearestNode(itpLatLng);
    const path = dijkstra(startNode, endNode);
    
    // Actualizar panel de accesibilidad (funcionalidad existente)
    updateAccessibilityPanel(e.latlng);

    // Manejo de la ruta
    if (document.getElementById('toggle-route').checked) {
        drawRoute(path).addTo(map);
    } else if (routeLayer) {
        // Si el toggle está desactivado, remover la ruta si existe
        map.removeLayer(routeLayer);
        routeLayer = null;
    }
});

function findNearestNode(latlng) {
    let nearestNode = null;
    let minDist = Infinity;

    const clickedLat = latlng.lat;
    const clickedLng = latlng.lng;

    for (const key in graph) {
        const [nodeLat, nodeLng] = key.split(',').map(parseFloat);
        const dist = Math.hypot(nodeLat - clickedLat, nodeLng - clickedLng);

        if (dist < minDist) {
            minDist = dist;
            nearestNode = key;
        }
    }
    return nearestNode;
}

function dijkstra(start, end) {
    const distances = {};
    const previous = {};
    const queue = new Set(Object.keys(graph));

    for (const node of queue) {
        distances[node] = Infinity;
    }
    distances[start] = 0;

    while (queue.size > 0) {
        // Elegir el nodo con la distancia más corta
        let currentNode = null;
        let minDistance = Infinity;
        for (const node of queue) {
            if (distances[node] < minDistance) {
                minDistance = distances[node];
                currentNode = node;
            }
        }

        if (currentNode === end) break;

        queue.delete(currentNode);

        for (const neighbor of graph[currentNode]) {
            const alt = distances[currentNode] + neighbor.distance;
            if (alt < distances[neighbor.node]) {
                distances[neighbor.node] = alt;
                previous[neighbor.node] = currentNode;
            }
        }
    }

    // Reconstruir el camino
    const path = [];
    let current = end;
    while (current) {
        path.unshift(current);
        current = previous[current];
    }
    return path;
}

let routeLayer = null; // Para poder borrar la ruta anterior

function drawRoute(path) {
    if (routeLayer) {
        map.removeLayer(routeLayer);
    }

    const latlngs = path.map(key => {
        const [lat, lng] = key.split(',').map(parseFloat);
        return [lat, lng];
    });

    // Crear una capa SVG para efectos más avanzados
    routeLayer = L.layerGroup().addTo(map);
    
    // Línea principal con efecto de animación
    const mainLine = L.polyline(latlngs, {
        color: '#3498db',
        weight: 6,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: '15, 10',
        className: 'route-line'
    }).addTo(routeLayer);

    // Línea secundaria para efecto de borde
    L.polyline(latlngs, {
        color: '#fff',
        weight: 8,
        opacity: 0.7,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(routeLayer);

    // Añadir marcadores de inicio/fin
    if (latlngs.length > 0) {
        // Marcador de inicio
        L.circleMarker(latlngs[0], {
            radius: 8,
            fillColor: "#2ecc71",
            color: "#fff",
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(routeLayer).bindTooltip("Punto de inicio", {permanent: false, direction: 'top'});

        // Marcador de fin (ITP)
        L.circleMarker(latlngs[latlngs.length-1], {
            radius: 8,
            fillColor: "#e74c3c",
            color: "#fff",
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(routeLayer).bindTooltip("ITP", {permanent: false, direction: 'top'});
    }

    // Añadir flechas direccionales cada ciertos segmentos
    for (let i = 0; i < latlngs.length - 1; i += 5) {
        const start = latlngs[i];
        const end = latlngs[i+1];
        const mid = [
            (start[0] + end[0]) / 2,
            (start[1] + end[1]) / 2
        ];
        
        const angle = Math.atan2(end[1] - start[1], end[0] - start[0]) * 180 / Math.PI;
        
        L.marker(mid, {
            icon: L.divIcon({
                className: 'route-arrow',
                html: `<svg viewBox="0 0 20 20" width="15" height="15" style="transform: rotate(${angle}deg)">
                        <path d="M0,10 L20,10 L10,0 Z" fill="#e74c3c"/>
                      </svg>`,
                iconSize: [15, 15],
                iconAnchor: [7.5, 7.5]
            }),
            interactive: false
        }).addTo(routeLayer);
    }
}

function setupLayerControl() {
    const toggleStreets = document.getElementById('toggle-streets');
    const toggleRoute = document.getElementById('toggle-route');
    const streetsLabel = document.querySelector('#toggle-streets ~ .label-text');
    const routeLabel = document.querySelector('#toggle-route ~ .label-text');

    // Configuración para vialidades
    if (map.hasLayer(streetsLayer)) {
        map.removeLayer(streetsLayer);
    }
    toggleStreets.checked = false;
    streetsLabel.textContent = 'Mostrar Vialidades';

    toggleStreets.addEventListener('change', function() {
        if (this.checked) {
            map.addLayer(streetsLayer);
            streetsLabel.textContent = 'Ocultar Vialidades';
        } else {
            map.removeLayer(streetsLayer);
            streetsLabel.textContent = 'Mostrar Vialidades';
        }
    });

    // Configuración para rutas
    toggleRoute.checked = false;
    routeLabel.textContent = 'Mostrar Ruta';

    toggleRoute.addEventListener('change', function() {
        if (!this.checked && routeLayer) {
            map.removeLayer(routeLayer);
            routeLayer = null;
        }
        routeLabel.textContent = this.checked ? 'Ocultar Ruta' : 'Mostrar Ruta';
    });
}


async function initMap() {
    await loadGeoTIFF('assets/pachuca.tif');
    await loadShapefilePoint();
    await loadStreets();

}


initMap();
