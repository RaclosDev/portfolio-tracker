package com.cartera.service.market;

import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/** Peticiones de una en una y separadas un tiempo mínimo, para no saturar las webs que no son API. */
public final class Throttle {

    private final long gapMs;
    private final ReentrantLock lock = new ReentrantLock(true);
    private long last;

    public Throttle(long gapMs) {
        this.gapMs = gapMs;
    }

    public <T> T run(Supplier<T> request) {
        lock.lock();
        try {
            long wait = gapMs - (System.currentTimeMillis() - last);
            if (wait > 0) Thread.sleep(wait);
            last = System.currentTimeMillis();
            return request.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new MarketSourceException("Consulta interrumpida", e);
        } finally {
            lock.unlock();
        }
    }
}
