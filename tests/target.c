#include <string.h>
void f(char* in) {
    char b[8];
    strcpy(b, in);
}
struct point { int x; int y; };
static int add(int a, int b) { return a + b; }
int main(int argc, char** argv) {
    struct point p = { 1, 2 };
    int (*op)(int, int) = add;
    if (argc > 1) {
        return op(p.x, p.y);
    }
    return strlen(argv[0]);
}
