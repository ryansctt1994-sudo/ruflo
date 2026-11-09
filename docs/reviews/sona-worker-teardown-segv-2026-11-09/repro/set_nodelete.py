"""Copy an ELF64 shared object and set DF_1_NODELETE in its DT_FLAGS_1 entry.
Only that one bit changes; everything else is byte-identical.
Usage: python3 set_nodelete.py <src.node> <dst.node>"""
import shutil
import struct
import sys

DT_NULL, DT_FLAGS_1, DF_1_NODELETE = 0, 0x6FFFFFFB, 0x8
src, dst = sys.argv[1], sys.argv[2]
shutil.copyfile(src, dst)
with open(dst, "r+b") as f:
    data = bytearray(f.read())
    assert data[:4] == b"\x7fELF" and data[4] == 2 and data[5] == 1, "need ELF64 little-endian"
    e_shoff, = struct.unpack_from("<Q", data, 0x28)
    e_shentsize, e_shnum = struct.unpack_from("<HH", data, 0x3A)
    for i in range(e_shnum):
        sh = e_shoff + i * e_shentsize
        sh_type, = struct.unpack_from("<I", data, sh + 4)
        if sh_type != 6:  # SHT_DYNAMIC
            continue
        off, size = struct.unpack_from("<QQ", data, sh + 0x18)
        for p in range(off, off + size, 16):
            tag, val = struct.unpack_from("<qQ", data, p)
            if tag == DT_NULL:
                break
            if tag == DT_FLAGS_1:
                struct.pack_into("<Q", data, p + 8, val | DF_1_NODELETE)
                f.seek(0)
                f.write(data)
                print(f"DT_FLAGS_1 {val:#x} -> {val | DF_1_NODELETE:#x}")
                sys.exit(0)
    sys.exit("no DT_FLAGS_1 entry found")
