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

namespace app::net {
    class Client {
    public:
        explicit Client(const std::string& host) : host_(host) {}
        std::string get(const std::string& path) {
            std::string url = host_ + path;
            return fetch(url.c_str());
        }
        void reset() { host_.clear(); }
    private:
        std::string host_;
    };
}

template <typename T>
T largest(const std::vector<T>& xs) {
    T best = xs[0];
    for (const auto& x : xs) {
        if (x > best) best = x;
    }
    return best;
}

int compute(int* p, int& r, const char* text) {
    auto add = [](int a, int b) { return a + b; };
    int total = add(*p, r);
    if (text == nullptr) {
        return -1;
    }
    for (int i = 0; i < 3; i++) {
        total += i;
    }
    unsigned long len = strlen(text);
    char* copy = (char*)malloc(len + 1);
    memcpy(copy, text, len + 1);
    free(copy);
    return total * 2;
}

#define SQUARE(x) ((x) * (x))
static int sq = SQUARE(4);
