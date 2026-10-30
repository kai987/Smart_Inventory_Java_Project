package com.kai987.smartinventory.web.dto.product;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record UpdateProductNamesRequest(
        @NotBlank @Size(max = 100)
        @Pattern(regexp = "^[^,|:\\r\\n]+$", message = "Name contains a reserved character.")
        @JsonDeserialize(using = StrictNameDeserializer.class) String name,
        @Size(max = 100) @Pattern(regexp = "^[^,|:\\r\\n]*$", message = "Name contains a reserved character.")
        @JsonDeserialize(using = StrictNameDeserializer.class) String nameJa,
        @Size(max = 100) @Pattern(regexp = "^[^,|:\\r\\n]*$", message = "Name contains a reserved character.")
        @JsonDeserialize(using = StrictNameDeserializer.class) String nameZh) {
}
