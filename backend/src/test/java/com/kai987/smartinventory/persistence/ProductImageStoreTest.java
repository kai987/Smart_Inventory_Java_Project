package com.kai987.smartinventory.persistence;

import static org.junit.jupiter.api.Assertions.*;
import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.kai987.smartinventory.domain.*;
import com.kai987.smartinventory.web.error.*;

class ProductImageStoreTest {
    @TempDir Path directory;
    static final byte[] PNG=Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+Xr9sAAAAASUVORK5CYII=");

    @Test void validatesBoundsTypeAndTruncationBeforeCreatingFiles() {
        var images=new ProductImageStore(directory);
        assertDoesNotThrow(()->ProductImageStore.validate(PNG,"image/png"));
        assertEquals(ErrorCode.IMAGE_SIZE,assertThrows(DomainException.class,()->images.save(new ByteArrayInputStream(new byte[ProductImageStore.MAX_BYTES+1]),"image/png",-1)).getErrorCode());
        assertEquals(ErrorCode.IMAGE_EMPTY,assertThrows(DomainException.class,()->images.save(new ByteArrayInputStream(new byte[0]),"image/png",-1)).getErrorCode());
        for (byte[] invalid: new byte[][]{Arrays.copyOf(PNG,8),Arrays.copyOf(PNG,PNG.length-1),"<svg/>".getBytes()}) {
            assertEquals(ErrorCode.IMAGE_TYPE,assertThrows(DomainException.class,()->images.save(new ByteArrayInputStream(invalid),"image/png",-1)).getErrorCode());
        }
        assertEquals(ErrorCode.IMAGE_TYPE,assertThrows(DomainException.class,()->images.save(new ByteArrayInputStream(PNG),"image/jpeg",-1)).getErrorCode());
        assertFalse(Files.exists(directory.resolve("uploads")));
    }

    @Test void jpegAndWebpStructureAcceptsCompleteImageDataAndRejectsTruncation() throws Exception {
        var output=new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(1,1,java.awt.image.BufferedImage.TYPE_INT_RGB),"jpeg",output);
        byte[] jpeg=output.toByteArray();
        byte[] webp=Base64.getDecoder().decode("UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAA=");
        assertDoesNotThrow(()->ProductImageStore.validate(jpeg,"image/jpeg"));
        assertThrows(DomainException.class,()->ProductImageStore.validate(Arrays.copyOf(jpeg,jpeg.length-1),"image/jpeg"));
        assertDoesNotThrow(()->ProductImageStore.validate(webp,"image/webp"));
        assertThrows(DomainException.class,()->ProductImageStore.validate(Arrays.copyOf(webp,webp.length-1),"image/webp"));
    }

    @Test void immutableImageAndCsvOrderSnapshotSurviveRemovalAndRestart() throws Exception {
        var images=new ProductImageStore(directory);
        String url=images.save(new ByteArrayInputStream(PNG),"image/png",PNG.length);
        assertArrayEquals(PNG,images.read(url.substring("/api/product-images/".length())).bytes());
        Product product=new Product("P901","Cup",1200,4,0.3,"カップ",null,"kitchen",url);
        Product reloaded=Product.fromCsv(product.toCsv());
        assertEquals("kitchen",reloaded.getCategory());
        assertEquals(url,reloaded.getImageUrl());
        Order order=new Order("O901","alice",java.util.List.of(new OrderItem(product,1)));
        Order restored=new OrderManager(new InventoryManager()).parseOrder(order.toCsv());
        assertEquals(url,restored.getItems().getFirst().getProductImageUrl());
        assertArrayEquals(PNG,new ProductImageStore(directory).read(url.substring("/api/product-images/".length())).bytes());
        assertNull(Product.fromCsv("P901,Cup,1200,4,0.3,,,bad,"+url));
        assertNull(Product.fromCsv("P901,Cup,1200,4,0.3,,,kitchen,https://example.com/image.png"));
        assertThrows(DomainException.class,()->images.read("../users.csv"));
        assertThrows(DomainException.class,()->images.requireExisting("/api/product-images/00000000-0000-0000-0000-000000000000.png"));
        assertThrows(DomainException.class,()->images.requireExisting("data:image/png;base64,abc"));
        Path target=directory.resolve("uploads/product-images").resolve(url.substring("/api/product-images/".length()));
        Path linked=target.resolveSibling("00000000-0000-0000-0000-000000000000.png");
        Files.createSymbolicLink(linked,target);
        assertThrows(DomainException.class,()->images.read(linked.getFileName().toString()));
    }

    @Test void rejectsSymlinkedUploadDirectory() throws Exception {
        Path elsewhere=Files.createTempDirectory(directory,"elsewhere");
        Files.createSymbolicLink(directory.resolve("uploads"),elsewhere);
        assertThrows(PersistenceException.class,()->new ProductImageStore(directory).save(new ByteArrayInputStream(PNG),"image/png",PNG.length));
    }
}
