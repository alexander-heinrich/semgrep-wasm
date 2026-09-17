#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

void copy_name(const char* input) {
    char buf[64];
    strcpy(buf, input);
    strncpy(buf, input, sizeof(buf));
    printf(buf);
    printf("%s\n", buf);
}

int run_listing(const std::string& dir) {
    const char* home = getenv("HOME");
    std::string cmd = "ls " + dir;
    system(cmd.c_str());
    system("ls -la");
    return system(home);
}

class Svc {
public:
    explicit Svc(int n) : n_(n) {}
    int twice() const { return n_ * 2; }
private:
    int n_;
};
