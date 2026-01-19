import { useEffect, useState } from 'react';
import { useOptimizationStore } from '../../stores/optimizationStore';
import type { Material } from '../../types';

interface MaterialGroup {
  metals: Material[];
  woods: Material[];
}

export function MaterialSelector() {
  const [materials, setMaterials] = useState<MaterialGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const { material, setMaterial } = useOptimizationStore();

  useEffect(() => {
    async function fetchMaterials() {
      try {
        const res = await fetch('/api/materials');
        if (!res.ok) {
          console.error('Materials API error:', res.status, res.statusText);
          return;
        }
        const data = await res.json();
        console.log('Materials response:', data);
        if (data.materials) {
          setMaterials(data.materials);
        } else {
          console.error('Materials response missing materials field:', data);
        }
      } catch (error) {
        console.error('Failed to fetch materials:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchMaterials();
  }, []);

  if (loading) {
    return <div className="config-section">Loading materials...</div>;
  }

  return (
    <div className="config-section">
      <label htmlFor="material">Material</label>
      <select
        id="material"
        value={material}
        onChange={(e) => setMaterial(e.target.value)}
      >
        {materials && (
          <>
            <optgroup label="Woods">
              {materials.woods.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Metals">
              {materials.metals.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          </>
        )}
      </select>
    </div>
  );
}
