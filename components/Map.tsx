import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import { FaSearch, FaPen, FaTrash, FaRuler } from 'react-icons/fa';

// Import leaflet-draw properly
if (typeof window !== 'undefined') {
  require('leaflet-draw');
}

interface MapProps {}

interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
}

const Map: React.FC<MapProps> = () => {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [areaSize, setAreaSize] = useState<string>('0');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!mapRef.current && mapContainerRef.current) {
      mapRef.current = L.map(mapContainerRef.current, {
        // Disable default zoom control
        zoomControl: false
      }).setView([23.5937, 78.9629], 5);
      
      // Add custom positioned zoom control to bottom right
      L.control.zoom({
        position: 'bottomright'
      }).addTo(mapRef.current);
      
      L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
        maxZoom: 21,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '© Google Maps'
      }).addTo(mapRef.current);

      // Initialize drawing feature group
      drawnItemsRef.current = new L.FeatureGroup();
      mapRef.current.addLayer(drawnItemsRef.current);

      // Drawing events
      mapRef.current.on(L.Draw.Event.DRAWSTART, () => {
        setIsDrawing(true);
        if (drawnItemsRef.current) {
          drawnItemsRef.current.clearLayers();
        }
      });

      mapRef.current.on(L.Draw.Event.DRAWSTOP, () => {
        setIsDrawing(false);
      });

      mapRef.current.on(L.Draw.Event.CREATED, (e: any) => {
        const layer = e.layer;
        drawnItemsRef.current?.addLayer(layer);
        updateAreaSize();
        
        // Make the polygon editable
        layer.editing.enable();
      });

      // Update area when polygon is edited
      mapRef.current.on('editable:editing', updateAreaSize);
    }

    // Handle window resize
    const handleResize = () => {
      if (mapRef.current) {
        mapRef.current.invalidateSize();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  const updateAreaSize = () => {
    if (!drawnItemsRef.current) return;
    
    let totalArea = 0;
    drawnItemsRef.current.eachLayer((layer: any) => {
      if (layer instanceof L.Polygon) {
        const latLngs = layer.getLatLngs()[0];
        totalArea = L.GeometryUtil.geodesicArea(latLngs);
      }
    });

    // Convert to hectares and format
    const areaInHectares = totalArea / 10000;
    setAreaSize(areaInHectares.toFixed(2));
  };

  const startDrawing = () => {
    if (!mapRef.current) return;
    
    const polygonDrawHandler = new L.Draw.Polygon(mapRef.current, {
      showArea: true,
      shapeOptions: {
        color: '#3388ff',
        fillColor: '#3388ff',
        fillOpacity: 0.2,
        weight: 3,
        opacity: 0.8
      },
      touchIcon: new L.DivIcon({
        className: 'leaflet-div-icon',
        iconSize: new L.Point(20, 20),
        iconAnchor: new L.Point(10, 10)
      }),
      allowIntersection: false
    });
    
    polygonDrawHandler.enable();
  };

  useEffect(() => {
    const searchTimeout = setTimeout(async () => {
      if (searchQuery.trim().length < 2) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?` +
          `format=json&` +
          `q=${encodeURIComponent(searchQuery)}+Rajasthan+India&` +
          `limit=5&` +
          `dedupe=1`
        );
        
        const data = await response.json();
        
        const processedResults = data.map((item: any) => ({
          display_name: item.display_name,
          lat: item.lat,
          lon: item.lon
        }));

        setSearchResults(processedResults);
      } catch (error) {
        console.error('Search failed:', error);
      } finally {
        setIsSearching(false);
      }
    }, 30);

    return () => clearTimeout(searchTimeout);
  }, [searchQuery]);

  const handleResultClick = (result: SearchResult) => {
    if (!mapRef.current) return;

    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);

    mapRef.current.setView([lat, lon], 14, {
      animate: true,
      duration: 1.5
    });

    setSearchResults([]);
    setSearchQuery('');
  };

  return (
    <div className="relative w-full h-screen flex flex-col">
      {/* Search Bar - Responsive positioning */}
      <div className="absolute z-[1000] w-full px-4 sm:px-0 sm:w-72 sm:right-4 top-4">
        <div className="bg-white rounded-lg shadow-lg">
          <div className="p-2">
            <div className="relative flex items-center">
              <FaSearch className="absolute left-3 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search in Rajasthan..."
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm sm:text-base"
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
                    className="p-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0 text-sm sm:text-base"
                  >
                    {result.display_name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Drawing Tools Panel */}
      <div className="absolute z-[1000] left-4 top-4 bg-white rounded-lg shadow-lg p-4">
       
        <div className="flex flex-col gap-3">
          <button
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
              isDrawing ? 'bg-blue-500 text-white' : 'bg-gray-100 hover:bg-gray-200'
            }`}
            onClick={startDrawing}
          >
            <FaPen size={16} />
            <span>Draw Field</span>
          </button>
          
          <button
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200"
            onClick={() => {
              if (drawnItemsRef.current) {
                drawnItemsRef.current.clearLayers();
                setAreaSize('0');
              }
            }}
          >
            <FaTrash size={16} />
            <span>Clear</span>
          </button>

          <div className="mt-2 p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <FaRuler />
              <span>Area Size</span>
            </div>
            <div className="text-lg font-semibold text-blue-600">
              {areaSize} ha
            </div>
          </div>
        </div>
      </div>

      {/* Map Container - Responsive height */}
      <div 
        ref={mapContainerRef} 
        className="flex-1 w-full h-full min-h-[300px] rounded-lg shadow-lg"
      />
    </div>
  );
};

export default Map;