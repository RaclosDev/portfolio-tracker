package com.cartera.service.market;

import java.util.LinkedHashMap;
import java.util.Map;

/** Caché en memoria con un máximo de entradas: al llenarse se olvida la más antigua. */
public final class BoundedCache<V> {

    private final Map<String, V> map;

    public BoundedCache(int max) {
        this.map = new LinkedHashMap<>(16, 0.75f, false) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, V> eldest) {
                return size() > max;
            }
        };
    }

    public synchronized V get(String key) {
        return map.get(key);
    }

    public synchronized void put(String key, V value) {
        map.put(key, value);
    }

    public synchronized int size() {
        return map.size();
    }
}
