import java.io.InputStream;
import java.util.jar.JarFile;

/** jarsigner accepts unsigned JARs with exit 0; require signed AAB payloads. */
public class VerifyBundle {
    public static void main(String[] args) throws Exception {
        int verified = 0;
        java.security.cert.Certificate signingCertificate = null;
        try (JarFile bundle = new JarFile(args[0], true)) {
            var entries = bundle.entries();
            byte[] buffer = new byte[65536];
            while (entries.hasMoreElements()) {
                var entry = entries.nextElement();
                if (entry.isDirectory() || entry.getName().startsWith("META-INF/")) continue;
                try (InputStream stream = bundle.getInputStream(entry)) {
                    while (stream.read(buffer) != -1) { /* Trigger signature verification. */ }
                }
                if (entry.getCodeSigners() == null || entry.getCodeSigners().length != 1) {
                    throw new SecurityException("Unsigned or multiply signed AAB entry: " + entry.getName());
                }
                var certificate = entry.getCodeSigners()[0].getSignerCertPath().getCertificates().get(0);
                if (signingCertificate == null) signingCertificate = certificate;
                if (!signingCertificate.equals(certificate)) {
                    throw new SecurityException("AAB entries have different signing certificates.");
                }
                verified++;
            }
        }
        if (verified == 0) throw new SecurityException("AAB has no signed payload entries.");
        System.out.println("Verified AAB signatures: " + verified + " payload entries.");
        var digest = java.security.MessageDigest.getInstance("SHA-256").digest(signingCertificate.getEncoded());
        System.out.println("AAB certificate SHA256: " + java.util.HexFormat.of().formatHex(digest));
    }
}
