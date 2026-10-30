package com.kai987.smartinventory.persistence;

import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import com.kai987.smartinventory.domain.Product;
import com.kai987.smartinventory.web.error.DomainException;
import com.kai987.smartinventory.web.error.ErrorCode;

/** Immutable uploads are retained independently of product/order lifetimes. */
public final class ProductImageStore {
    public static final int MAX_BYTES = 2 * 1024 * 1024;
    private static final Map<String, String> EXTENSIONS = Map.of("image/png", "png", "image/jpeg", "jpg", "image/webp", "webp");
    private final Path dataDirectory;
    public record Image(byte[] bytes, String contentType) { }

    public ProductImageStore(Path dataDirectory) { this.dataDirectory = dataDirectory.toAbsolutePath().normalize(); }

    public synchronized String save(InputStream input, String mime, long contentLength) {
        String extension = EXTENSIONS.get(mime);
        if (extension == null) throw new DomainException(ErrorCode.IMAGE_TYPE, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
        if (contentLength > MAX_BYTES) throw new DomainException(ErrorCode.IMAGE_SIZE);
        Path temporary = null;
        try {
            byte[] bytes = input.readNBytes(MAX_BYTES + 1);
            validate(bytes, mime);
            Path directory = directory(true);
            temporary = Files.createTempFile(directory, ".upload-", ".tmp");
            try (FileChannel file = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = ByteBuffer.wrap(bytes);
                while (buffer.hasRemaining()) file.write(buffer);
                file.force(true);
            }
            String filename = UUID.randomUUID() + "." + extension;
            // An atomic hard-link publication cannot overwrite an existing immutable object.
            Files.createLink(directory.resolve(filename), temporary);
            return "/api/product-images/" + filename;
        } catch (IOException exception) {
            throw new PersistenceException("Could not store the product image safely.", exception);
        } finally {
            if (temporary != null) try { Files.deleteIfExists(temporary); } catch (IOException ignored) { }
        }
    }

    public Image read(String filename) {
        String mime = mime(filename);
        if (mime == null) throw new DomainException(ErrorCode.NOT_FOUND);
        try {
            Path path = directory(false).resolve(filename);
            if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(path) || Files.size(path) > MAX_BYTES) throw new DomainException(ErrorCode.NOT_FOUND);
            byte[] bytes;
            try (InputStream input = Files.newInputStream(path)) { bytes = input.readNBytes(MAX_BYTES + 1); }
            try { validate(bytes, mime); } catch (DomainException exception) { throw new DomainException(ErrorCode.NOT_FOUND); }
            return new Image(bytes, mime);
        } catch (IOException exception) { throw new DomainException(ErrorCode.NOT_FOUND); }
    }

    public void requireExisting(String imageUrl) {
        if (imageUrl == null) return;
        if (!Product.isValidImageUrl(imageUrl)) throw invalidReference();
        try { read(imageUrl.substring("/api/product-images/".length())); }
        catch (DomainException exception) { throw invalidReference(); }
    }

    private static DomainException invalidReference() {
        return new DomainException(ErrorCode.VALIDATION_ERROR, "Select an uploaded product image.",
                java.util.List.of(new com.kai987.smartinventory.web.dto.error.FieldErrorResponse("imageUrl", "Select an uploaded product image.")));
    }

    private Path directory(boolean create) throws IOException {
        Path path = dataDirectory;
        if (!Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(path)) throw new IOException("Unsafe image directory.");
        for (String component : new String[]{"uploads", "product-images"}) {
            path = path.resolve(component);
            if (create && !Files.exists(path, LinkOption.NOFOLLOW_LINKS)) Files.createDirectory(path);
            if (!Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(path)) throw new IOException("Unsafe image directory.");
        }
        return path;
    }

    public static String mime(String filename) {
        if (!Product.isValidImageUrl("/api/product-images/" + filename)) return null;
        return switch (filename.substring(filename.lastIndexOf('.') + 1)) { case "png" -> "image/png"; case "jpg" -> "image/jpeg"; case "webp" -> "image/webp"; default -> null; };
    }

    public static void validate(byte[] bytes, String mime) {
        if (bytes.length > MAX_BYTES) throw new DomainException(ErrorCode.IMAGE_SIZE);
        if (bytes.length == 0) throw new DomainException(ErrorCode.IMAGE_EMPTY);
        boolean valid = switch (mime) { case "image/png" -> png(bytes); case "image/jpeg" -> jpeg(bytes); case "image/webp" -> webp(bytes); default -> false; };
        if (!valid) throw new DomainException(ErrorCode.IMAGE_TYPE);
    }

    private static int be16(byte[] bytes, int offset) { return ((bytes[offset] & 255) << 8) | (bytes[offset + 1] & 255); }
    private static long integer(byte[] bytes, int offset, ByteOrder order) { return Integer.toUnsignedLong(ByteBuffer.wrap(bytes, offset, 4).order(order).getInt()); }
    private static boolean kind(byte[] bytes, int position, String value) { return Arrays.equals(Arrays.copyOfRange(bytes, position, position + 4), value.getBytes(java.nio.charset.StandardCharsets.US_ASCII)); }

    private static boolean png(byte[] bytes) {
        byte[] signature = {(byte)137,80,78,71,13,10,26,10};
        if (bytes.length < 8 || !Arrays.equals(Arrays.copyOf(bytes, 8), signature)) return false;
        int position = 8;
        boolean header = false, data = false;
        while (position + 12L <= bytes.length) {
            long size = integer(bytes, position, ByteOrder.BIG_ENDIAN);
            long end = position + 12L + size;
            if (end > bytes.length) return false;
            if (!header) {
                if (!kind(bytes, position + 4, "IHDR") || size != 13 || integer(bytes,position+8,ByteOrder.BIG_ENDIAN)==0 || integer(bytes,position+12,ByteOrder.BIG_ENDIAN)==0) return false;
                header = true;
            } else if (kind(bytes,position+4,"IHDR")) return false;
            if (kind(bytes,position+4,"IDAT") && size>0) data = true;
            if (kind(bytes,position+4,"IEND")) return size == 0 && data && end == bytes.length;
            position = (int) end;
        }
        return false;
    }

    private static boolean jpeg(byte[] bytes) {
        if (bytes.length < 2 || (bytes[0]&255)!=255 || (bytes[1]&255)!=216) return false;
        int position = 2;
        boolean scan = false, frame = false, sawScan = false, entropy = false;
        while (position < bytes.length) {
            if (scan) { int start=position; while (position < bytes.length && (bytes[position]&255)!=255) position++; entropy |= position>start; }
            if (position>=bytes.length || (bytes[position]&255)!=255) return false;
            while (position<bytes.length && (bytes[position]&255)==255) position++;
            if (position>=bytes.length) return false;
            int marker = bytes[position++] & 255;
            if (scan && (marker==0 || (marker>=208 && marker<=215))) continue;
            if (marker==217) return frame && sawScan && entropy && position==bytes.length;
            if (marker==216 || marker==0 || (marker>=208 && marker<=215)) return false;
            if (marker==1) continue;
            if (position+2>bytes.length) return false;
            int size = be16(bytes,position);
            if (size<2 || position+size>bytes.length) return false;
            if (marker>=192 && marker<=207 && marker!=196 && marker!=200 && marker!=204) {
                if (size<8 || be16(bytes,position+3)==0 || be16(bytes,position+5)==0 || bytes[position+7]==0 || size<8+3*(bytes[position+7]&255)) return false;
                frame=true;
            }
            scan=marker==218;
            if (scan) { if (size<6 || !frame) return false; sawScan=true; }
            position+=size;
        }
        return false;
    }

    private static boolean webp(byte[] bytes) {
        if (bytes.length<20 || !kind(bytes,0,"RIFF") || !kind(bytes,8,"WEBP") || integer(bytes,4,ByteOrder.LITTLE_ENDIAN)!=bytes.length-8) return false;
        return webpFrames(bytes,12,bytes.length,true);
    }

    private static boolean webpFrames(byte[] bytes,int start,int limit,boolean allowAnimation) {
        int position=start;
        boolean frame=false;
        while (position+8L<=limit) {
            long size=integer(bytes,position+4,ByteOrder.LITTLE_ENDIAN), end=position+8L+size+(size%2);
            if (end>limit) return false;
            int payload=position+8;
            if (kind(bytes,position,"VP8 ")) {
                if (size<11 || (bytes[payload+3]&255)!=157 || bytes[payload+4]!=1 || bytes[payload+5]!=42 || (((bytes[payload+7]&255)<<8 | (bytes[payload+6]&255))&16383)==0 || (((bytes[payload+9]&255)<<8 | (bytes[payload+8]&255))&16383)==0) return false;
                frame=true;
            } else if (kind(bytes,position,"VP8L")) { if (size<6 || bytes[payload]!=47 || (bytes[payload+4]&224)!=0) return false; frame=true; }
            else if (kind(bytes,position,"VP8X")) { if (size!=10) return false; }
            else if (kind(bytes,position,"ANMF")) { if (!allowAnimation || size<30 || !webpFrames(bytes,position+24,(int)(position+8+size),false)) return false; frame=true; }
            position=(int)end;
        }
        return frame && position==limit;
    }
}
