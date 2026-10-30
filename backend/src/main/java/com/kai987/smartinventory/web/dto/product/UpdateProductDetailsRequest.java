package com.kai987.smartinventory.web.dto.product;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Setter presence distinguishes preserving an image from explicitly clearing it. */
public final class UpdateProductDetailsRequest {
    @NotBlank @Size(max=100) @Pattern(regexp="^[^,|:\\r\\n]+$")
    @JsonDeserialize(using=StrictNameDeserializer.class)
    private String name;
    @Size(max=100) @Pattern(regexp="^[^,|:\\r\\n]*$")
    @JsonDeserialize(using=StrictNameDeserializer.class)
    private String nameJa;
    @Size(max=100) @Pattern(regexp="^[^,|:\\r\\n]*$")
    @JsonDeserialize(using=StrictNameDeserializer.class)
    private String nameZh;
    @NotBlank @Pattern(regexp="electronics|home|kitchen|travel|sports|stationery|other")
    @JsonDeserialize(using=StrictNameDeserializer.class)
    private String category;
    @JsonDeserialize(using=StrictNameDeserializer.class)
    private String imageUrl;
    private boolean imageUrlPresent;

    public String getName() { return name; }
    public void setName(String name) { this.name=name; }
    public String getNameJa() { return nameJa; }
    public void setNameJa(String nameJa) { this.nameJa=nameJa; }
    public String getNameZh() { return nameZh; }
    public void setNameZh(String nameZh) { this.nameZh=nameZh; }
    public String getCategory() { return category; }
    public void setCategory(String category) { this.category=category; }
    public String getImageUrl() { return imageUrl; }
    public void setImageUrl(String imageUrl) { this.imageUrl=imageUrl; this.imageUrlPresent=true; }
    public boolean imageUrlPresent() { return imageUrlPresent; }
}
