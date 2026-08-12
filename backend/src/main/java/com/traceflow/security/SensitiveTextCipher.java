package com.traceflow.security;

import com.sun.jna.platform.win32.Crypt32Util;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.Base64;

@Service
public class SensitiveTextCipher {
    private static final String PREFIX = "enc:v1:";
    private static final int IV_LENGTH = 12;
    private final SecretKey key;
    private final SecureRandom random = new SecureRandom();

    public SensitiveTextCipher(@Value("${traceflow.data-dir}") Path dataDir,
                               @Value("${traceflow.key-protection:dpapi}") String keyProtection) {
        this.key = loadKey(dataDir, keyProtection);
    }

    public String encrypt(String plaintext) {
        if (plaintext == null || plaintext.isEmpty()) return plaintext;
        try {
            byte[] iv = new byte[IV_LENGTH];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
            byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            return PREFIX + Base64.getEncoder().encodeToString(ByteBuffer.allocate(iv.length + ciphertext.length)
                    .put(iv).put(ciphertext).array());
        } catch (Exception exception) {
            throw new IllegalStateException("敏感数据加密失败", exception);
        }
    }

    public String decrypt(String storedValue) {
        if (storedValue == null || !storedValue.startsWith(PREFIX)) return storedValue;
        try {
            byte[] payload = Base64.getDecoder().decode(storedValue.substring(PREFIX.length()));
            byte[] iv = java.util.Arrays.copyOfRange(payload, 0, IV_LENGTH);
            byte[] ciphertext = java.util.Arrays.copyOfRange(payload, IV_LENGTH, payload.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        } catch (Exception exception) {
            throw new IllegalStateException("敏感数据解密失败，密钥可能已损坏", exception);
        }
    }

    private SecretKey loadKey(Path dataDir, String keyProtection) {
        try {
            if ("test".equalsIgnoreCase(keyProtection)) {
                KeyGenerator generator = KeyGenerator.getInstance("AES");
                generator.init(256);
                return generator.generateKey();
            }
            if (!System.getProperty("os.name", "").toLowerCase().contains("windows")) {
                throw new IllegalStateException("一期正式版仅支持 Windows DPAPI");
            }
            Files.createDirectories(dataDir);
            Path keyFile = dataDir.resolve("traceflow-master-key.dpapi");
            byte[] rawKey;
            if (Files.exists(keyFile)) {
                rawKey = Crypt32Util.cryptUnprotectData(Files.readAllBytes(keyFile));
            } else {
                KeyGenerator generator = KeyGenerator.getInstance("AES");
                generator.init(256);
                rawKey = generator.generateKey().getEncoded();
                Path temporary = dataDir.resolve("traceflow-master-key.dpapi.tmp");
                Files.write(temporary, Crypt32Util.cryptProtectData(rawKey));
                try {
                    Files.move(temporary, keyFile, java.nio.file.StandardCopyOption.ATOMIC_MOVE);
                } catch (java.nio.file.AtomicMoveNotSupportedException ignored) {
                    Files.move(temporary, keyFile, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                }
            }
            return new SecretKeySpec(rawKey, "AES");
        } catch (Exception exception) {
            throw new IllegalStateException("无法初始化 Windows DPAPI 数据密钥", exception);
        }
    }
}
