CC ?= cc
NATIVE := ../..
OUT := $(NATIVE)/target/ffi-example
LIB := $(NATIVE)/target/release/libmesh_avatar_ffi.a
CFLAGS ?= -std=c11 -O2 -Wall -Wextra -Werror
UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
LDLIBS ?= -lm
else
LDLIBS ?= -ldl -lpthread -lm
endif

.PHONY: all run
all: $(OUT)
$(OUT): main.c $(NATIVE)/include/mesh_avatar.h $(LIB)
	$(CC) $(CFLAGS) -I$(NATIVE)/include main.c $(LIB) $(LDLIBS) -o $@
run: $(OUT)
	$(OUT) $(NATIVE)/../samples/miko-qipao
