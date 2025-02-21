import { useEffect, useRef } from 'react';
import L from 'leaflet';
import * as turf from '@turf/turf';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';

if (typeof window !== 'undefined') {
  require('leaflet-draw');
}

interface MapProps {
  onAreaUpdate?: (area: number) => void;
}

const Map: React.FC<MapProps> = ({ onAreaUpdate }) => {
  const mapRef = useRef<L.Map | null>(null);
  const drawingLayerRef = useRef<L.FeatureGroup | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Fix Leaflet icons
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png').default,
      iconUrl: require('leaflet/dist/images/marker-icon.png').default,
      shadowUrl: require('leaflet/dist/images/marker-shadow.png').default,
    });

    if (!mapRef.current && mapContainerRef.current) {
      mapRef.current = L.map(mapContainerRef.current).setView([20.5937, 78.9629], 5);
      
      L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
        maxZoom: 19,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '© Google Maps'
      }).addTo(mapRef.current);

      drawingLayerRef.current = new L.FeatureGroup();
      mapRef.current.addLayer(drawingLayerRef.current);

      const drawControl = new (L.Control as any).Draw({
        draw: {
          polygon: {
            allowIntersection: false,
            drawError: {
              color: '#e1e100',
              message: '<strong>Error:</strong> Polygon edges cannot cross!'
            },
            shapeOptions: {
              color: '#3388ff'
            }
          },
          circle: false,
          rectangle: false,
          circlemarker: false,
          marker: false,
          polyline: false
        },
        edit: {
          featureGroup: drawingLayerRef.current
        }
      });

      mapRef.current.addControl(drawControl);

      mapRef.current.on(L.Draw.Event.CREATED, (e: any) => {
        const layer = e.layer;
        if (drawingLayerRef.current) {
          drawingLayerRef.current.addLayer(layer);
          calculateArea(drawingLayerRef.current);
        }
      });

      mapRef.current.on(L.Draw.Event.EDITED, () => {
        if (drawingLayerRef.current) {
          calculateArea(drawingLayerRef.current);
        }
      });

      mapRef.current.on(L.Draw.Event.DELETED, () => {
        if (drawingLayerRef.current) {
          calculateArea(drawingLayerRef.current);
        }
      });
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  const calculateArea = (layer: L.FeatureGroup) => {
    const polygons = [];
    layer.eachLayer((l: any) => {
      if (l instanceof L.Polygon) {
        const coordinates = l.getLatLngs()[0].map((latLng: L.LatLng) => [
          latLng.lng,
          latLng.lat
        ]);
        polygons.push(coordinates);
      }
    });

    if (polygons.length > 0) {
      const polygon = turf.polygon([polygons[0]]);
      const area = turf.area(polygon);
      onAreaUpdate?.(area);
    } else {
      onAreaUpdate?.(0);
    }
  };

  return (
    <div ref={mapContainerRef} style={{ height: '600px', width: '100%' }} />
  );
};

export default Map;