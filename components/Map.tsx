import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import * as turf from '@turf/turf';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import { FaSearch } from 'react-icons/fa';

if (typeof window !== 'undefined') {
  require('leaflet-draw');
}

interface MapProps {
  onAreaUpdate?: (area: number) => void;
}

interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
}

const Map: React.FC<MapProps> = ({ onAreaUpdate }) => {
  const mapRef = useRef<L.Map | null>(null);
  const drawingLayerRef = useRef<L.FeatureGroup | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const searchMarkerRef = useRef<L.Marker | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Debounced search function with reduced delay (100ms)
  useEffect(() => {
    const searchTimeout = setTimeout(async () => {
      if (searchQuery.trim().length < 3) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?` +
          `format=json&q=${encodeURIComponent(searchQuery)}, India&` +
          `limit=5`
        );
        const data = await response.json();
        setSearchResults(data);
      } catch (error) {
        console.error('Search failed:', error);
      } finally {
        setIsSearching(false);
      }
    }, 100); // Changed from 300ms to 100ms

    return () => clearTimeout(searchTimeout);
  }, [searchQuery]);

  const handleResultClick = (result: SearchResult) => {
    if (!mapRef.current) return;

    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);

    // Remove existing marker if any
    if (searchMarkerRef.current) {
      searchMarkerRef.current.remove();
    }

    // Initial zoom out for animation effect
    mapRef.current.setView([lat, lon], 5, {
      animate: true,
      duration: 1.5
    });

    // Delayed zoom in to city level
    setTimeout(() => {
      mapRef.current?.flyTo([lat, lon], 12, {  // Reduced zoom level to 12 for city-level view
        animate: true,
        duration: 2.5,
        easeLinearity: 0.15
      });

      // Add marker after zoom animation
      setTimeout(() => {
        const redIcon = new L.Icon({
          iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          shadowSize: [41, 41]
        });

        // Place marker at exact coordinates
        searchMarkerRef.current = L.marker([lat, lon], { 
          icon: redIcon,
          zIndexOffset: 1000
        }).addTo(mapRef.current!);

        // Center map exactly on the marker
        mapRef.current?.panTo([lat, lon], {
          animate: true,
          duration: 0.5
        });
      }, 2500);
    }, 1500);

    setSearchResults([]);
    setSearchQuery('');
  };

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
    <div className="relative">
      <div className="absolute top-4 left-4 z-[1000] bg-white rounded-lg shadow-lg w-72">
        <div className="p-2">
          <div className="relative flex items-center">
            <FaSearch className="absolute left-3 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search for a location..."
              className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {isSearching && (
              <div className="absolute right-3 text-gray-500">
                ...
              </div>
            )}
          </div>

          {searchResults.length > 0 && (
            <div className="mt-2 bg-white rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {searchResults.map((result, index) => (
                <div
                  key={index}
                  onClick={() => handleResultClick(result)}
                  className="p-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0"
                >
                  {result.display_name}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div ref={mapContainerRef} style={{ height: '600px', width: '100%' }} />
    </div>
  );
};

export default Map;