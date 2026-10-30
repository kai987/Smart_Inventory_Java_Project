package com.kai987.smartinventory.web.controller;

import java.io.IOException;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import com.kai987.smartinventory.service.SmartInventoryService;
import jakarta.servlet.http.HttpServletRequest;

@RestController
@RequestMapping("/api/product-images")
public final class ProductImageController {
    private final SmartInventoryService service;
    public ProductImageController(SmartInventoryService service) { this.service=service; }

    @PostMapping
    public ResponseEntity<Map<String,String>> upload(HttpServletRequest request) throws IOException {
        String mime=request.getContentType()==null ? "" : request.getContentType().split(";",2)[0].trim().toLowerCase(java.util.Locale.ROOT);
        String imageUrl=service.uploadProductImage(request.getInputStream(),mime,request.getContentLengthLong());
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("imageUrl",imageUrl));
    }

    @GetMapping("/{filename}")
    public ResponseEntity<byte[]> image(@PathVariable String filename) {
        var image=service.productImage(filename);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(image.contentType()))
                .header("X-Content-Type-Options","nosniff")
                .header("Content-Security-Policy","default-src 'none'; sandbox")
                .header("Cache-Control","public, max-age=31536000, immutable")
                .body(image.bytes());
    }
}
