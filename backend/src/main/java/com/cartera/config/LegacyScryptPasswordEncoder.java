package com.cartera.config;

import org.bouncycastle.crypto.generators.SCrypt;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.concurrent.Semaphore;

/**
 * Comprueba los hashes de la versión anterior ({@code scrypt:<sal hex>:<clave hex>}, N=2^17, r=8, p=1, 64 bytes;
 * la sal se usa tal cual, como texto). Solo verifica: tras el primer inicio de sesión correcto la contraseña se
 * vuelve a guardar con el codificador actual. Cada comprobación usa unos 128 MB, así que van de dos en dos.
 */
public class LegacyScryptPasswordEncoder implements PasswordEncoder {

    private static final String PREFIX = "scrypt:";
    private static final int N = 1 << 17;
    private static final int R = 8;
    private static final int P = 1;
    private static final Semaphore WORKERS = new Semaphore(2);

    @Override
    public String encode(CharSequence rawPassword) {
        throw new UnsupportedOperationException("Los hashes scrypt antiguos solo se verifican.");
    }

    @Override
    public boolean matches(CharSequence rawPassword, String encodedPassword) {
        if (rawPassword == null || encodedPassword == null || !encodedPassword.startsWith(PREFIX)) return false;
        String[] parts = encodedPassword.split(":");
        if (parts.length != 3) return false;
        byte[] expected;
        try {
            expected = HexFormat.of().parseHex(parts[2]);
        } catch (IllegalArgumentException e) {
            return false;
        }
        try {
            WORKERS.acquire();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
        try {
            byte[] actual = SCrypt.generate(rawPassword.toString().getBytes(StandardCharsets.UTF_8),
                    parts[1].getBytes(StandardCharsets.UTF_8), N, R, P, expected.length);
            return MessageDigest.isEqual(actual, expected);
        } finally {
            WORKERS.release();
        }
    }

    @Override
    public boolean upgradeEncoding(String encodedPassword) {
        return true;
    }
}
